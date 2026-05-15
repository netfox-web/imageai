import { config } from '../../config/index.js';
import { fallbackPrompts, renderPromptByKey } from '../PromptRenderer.js';
import { FakeAIProvider } from '../FakeAIProvider.js';
import { AIProviderInterface } from '../AIProviderInterface.js';
import { parseJsonFromText } from '../OpenAIProvider.js';
import {
  buildProductCopyPrompt,
  normalizeTextResultMetadata,
  persistProductCopyOutput,
  throwIfTextResultFailed,
} from '../CopywritingService.js';

const defaultImageRoles = ['cover', 'scenario', 'detail', 'feature', 'multi_use'];

function normalizeAnalyzeJson(parsed, files) {
  return {
    productName: parsed.productName || parsed.product_name || '智能商品名稱',
    title: parsed.title || parsed.mainTitle || parsed.main_title || '吸睛主標語',
    subtitle: parsed.subtitle || '簡短副標語',
    customPrompt: parsed.customPrompt || parsed.custom_prompt || '明亮乾淨的電商廣告背景，突出商品主體',
    imageRoles: Array.isArray(parsed.imageRoles)
      ? parsed.imageRoles
      : Array.isArray(parsed.image_roles)
        ? parsed.image_roles
        : files.map((_, index) => defaultImageRoles[index % defaultImageRoles.length]),
  };
}

function extractClaudeText(response) {
  return response?.content?.map((part) => part.text || '').join('') || '';
}

function sanitizeClaudeResponse(payload) {
  return JSON.parse(
    JSON.stringify(payload, (key, value) => {
      if (key === 'data' && typeof value === 'string' && value.length > 200) return `[base64 omitted ${value.length} chars]`;
      if (typeof value === 'string' && value.length > 1200) return `${value.slice(0, 1200)}...[truncated]`;
      return value;
    }),
  );
}

export class ClaudeProvider extends AIProviderInterface {
  providerName = 'claude';
  modelName = config.claudeModel;

  constructor(options = {}) {
    super();
    this.fallbackProvider = options.fallbackProvider || new FakeAIProvider();
    this.fetchImpl = options.fetchImpl || fetch;
    this.lastRunMetadata = null;
  }

  async analyzeProductImages(files, language = 'zh-TW') {
    const prompt = renderPromptByKey('analyze_product_images', { language }, fallbackPrompts.analyze_product_images);
    return this.withFallback('analyzeProductImages', [files, language], async () => {
      if (!config.claudeApiKey) throw new Error('ANTHROPIC_API_KEY is not configured.');
      const response = await this.createMessage({
        model: config.claudeModel,
        max_tokens: 512,
        temperature: 0.2,
        system: prompt.systemPrompt || 'Analyze ecommerce product images and return strict JSON.',
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: [
                  prompt.userPrompt,
                  `Output language: ${language}.`,
                  'Return only JSON with productName, title, subtitle, customPrompt, and imageRoles.',
                ].join('\n'),
              },
              ...files.slice(0, 10).map((file) => ({
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: file.mimetype,
                  data: file.buffer.toString('base64'),
                },
              })),
            ],
          },
        ],
      });
      const parsed = parseJsonFromText(extractClaudeText(response));
      const result = normalizeAnalyzeJson(parsed, files);
      result._meta = {
        provider: this.providerName,
        model: config.claudeModel,
        usage: response.usage || null,
        raw_response_json: sanitizeClaudeResponse(response),
      };
      this.lastRunMetadata = result._meta;
      return result;
    });
  }

  async ping(options = {}) {
    return this.generateText({ prompt: 'Return exactly: CLAUDE_OK', model: options.model });
  }

  async generateText({ prompt, model } = {}) {
    return this.executeText({
      prompt: prompt || '',
      model,
      max_tokens: 1024,
      temperature: 0.2,
    });
  }

  async summarize({ text } = {}) {
    return this.generateText({ prompt: `Summarize the following text concisely:\n\n${text || ''}` });
  }

  async classify({ text, labels = [] } = {}) {
    return this.generateText({ prompt: `Classify the text into one of these labels: ${labels.join(', ')}.\n\nText:\n${text || ''}` });
  }

  async rewrite({ text, instruction = 'Rewrite clearly.' } = {}) {
    return this.generateText({ prompt: `${instruction}\n\nText:\n${text || ''}` });
  }

  async extract({ text, schema = {} } = {}) {
    return this.generateText({ prompt: `Extract structured data matching this JSON schema:\n${JSON.stringify(schema)}\n\nText:\n${text || ''}` });
  }

  async plan({ goal, constraints = [] } = {}) {
    return this.generateText({ prompt: `Create a practical plan for this goal:\n${goal || ''}\n\nConstraints:\n${constraints.join('\n')}` });
  }

  async promptRewrite({ prompt, goal = 'Improve clarity and reliability.' } = {}) {
    return this.generateText({ prompt: `Rewrite this prompt for the goal: ${goal}\n\nPrompt:\n${prompt || ''}` });
  }

  async generateBanner(task) {
    return this.withFallback('generateBanner', [task], async () => {
      throw new Error('Claude banner generation is scaffolded; use fake fallback until an image generation backend is configured.');
    });
  }

  async translateImage(task) {
    return this.fallbackProvider.translateImage(task);
  }

  async cutoutImage(task) {
    return this.fallbackProvider.cutoutImage(task);
  }

  async removeText(task) {
    return this.fallbackProvider.removeText(task);
  }

  async generateProductCopy(task) {
    return this.withFallback('generateProductCopy', [task], async () => {
      const result = await this.generateText({
        prompt: buildProductCopyPrompt(task),
        model: task.resolved_model || config.claudeModel,
      });
      throwIfTextResultFailed(result, 'Claude product copywriting failed.');
      const output = await persistProductCopyOutput(task, result.output);
      this.lastRunMetadata = normalizeTextResultMetadata(result, this.providerName, config.claudeModel);
      return [output];
    });
  }

  async createMessage(body) {
    const baseUrl = String(config.claudeBaseUrl || 'https://api.anthropic.com').replace(/\/+$/, '');
    const response = await this.fetchImpl(`${baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': config.claudeApiKey,
        'anthropic-version': config.claudeApiVersion || '2023-06-01',
      },
      body: JSON.stringify(body),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload.error?.message || `Claude request failed with ${response.status}`);
      error.status = response.status;
      error.code = payload.error?.type || response.status;
      throw error;
    }
    return payload;
  }

  async executeText({ prompt, model, max_tokens = 1024, temperature = 0.2 } = {}) {
    const startedAt = Date.now();
    const selectedModel = model || config.claudeModel || 'claude-3-5-haiku-latest';
    if (!config.claudeApiKey) {
      return this.errorResponse({
        model: selectedModel,
        startedAt,
        errorCode: 'missing_api_key',
        errorMessage: 'ANTHROPIC_API_KEY is not configured.',
        retryable: false,
        status: null,
      });
    }
    try {
      const response = await this.createMessage({
        model: selectedModel,
        max_tokens,
        temperature,
        messages: [{ role: 'user', content: [{ type: 'text', text: prompt || '' }] }],
      });
      const output = extractClaudeText(response).trim();
      return {
        ok: true,
        provider: this.providerName,
        model: selectedModel,
        output,
        usage: normalizeClaudeUsage(response.usage),
        latency_ms: Date.now() - startedAt,
        raw_response_json_safe: sanitizeClaudeResponse(response),
        error_code: null,
        error_message: null,
        retryable: false,
      };
    } catch (error) {
      return this.errorResponse({
        model: selectedModel,
        startedAt,
        errorCode: error.code || error.status || error.name || 'claude_request_failed',
        errorMessage: error.message,
        retryable: isRetryableError(error),
        status: error.status || null,
      });
    }
  }

  errorResponse({ model, startedAt, errorCode, errorMessage, retryable, status = null }) {
    return {
      ok: false,
      provider: this.providerName,
      model,
      output: '',
      usage: normalizeClaudeUsage(null),
      latency_ms: Date.now() - startedAt,
      raw_response_json_safe: null,
      error_code: String(errorCode || 'claude_error'),
      error_message: redactSecret(errorMessage, config.claudeApiKey),
      retryable: Boolean(retryable),
      http_status: status,
    };
  }

  async withFallback(method, args, callback) {
    try {
      return await callback();
    } catch (error) {
      if (config.aiStrictProvider) throw error;
      const result = await this.fallbackProvider[method](...args);
      const fallbackMetadata = this.fallbackProvider.consumeLastRunMetadata?.() || {};
      this.lastRunMetadata = {
        ...fallbackMetadata,
        provider: 'fake',
        model: 'fake',
        fallback_from: this.providerName,
        fallback_used: true,
        fallback_reason: error.message,
        error: error.message,
        error_code: error.code || error.name || 'provider_error',
      };
      if (result && typeof result === 'object' && !Array.isArray(result)) {
        result._meta = {
          ...(result._meta || {}),
          provider: 'fake',
          fallback_used: true,
          fallback_reason: error.message,
          requested_provider: this.providerName,
        };
      }
      return result;
    }
  }

  consumeLastRunMetadata() {
    const metadata = this.lastRunMetadata;
    this.lastRunMetadata = null;
    return metadata;
  }
}

function normalizeClaudeUsage(usage = null) {
  return {
    input_tokens: Number(usage?.input_tokens || 0),
    output_tokens: Number(usage?.output_tokens || 0),
    total_tokens: Number(usage?.input_tokens || 0) + Number(usage?.output_tokens || 0),
  };
}

function isRetryableError(error) {
  const status = Number(error.status || error.code || 0);
  return error.name === 'AbortError' || error.name === 'TimeoutError' || error instanceof TypeError || status === 429 || status >= 500;
}

function redactSecret(message = '', secret = '') {
  const text = String(message || '');
  return secret ? text.replaceAll(secret, '[redacted]') : text;
}
