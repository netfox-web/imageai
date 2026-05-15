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

function extractGeminiText(response) {
  return response?.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('') || '';
}

function sanitizeGeminiResponse(payload) {
  return JSON.parse(
    JSON.stringify(payload, (key, value) => {
      if (key === 'data' && typeof value === 'string' && value.length > 200) return `[base64 omitted ${value.length} chars]`;
      if (typeof value === 'string' && value.length > 1200) return `${value.slice(0, 1200)}...[truncated]`;
      return value;
    }),
  );
}

export class GeminiProvider extends AIProviderInterface {
  providerName = 'gemini';
  modelName = config.geminiModel;

  constructor(options = {}) {
    super();
    this.fallbackProvider = options.fallbackProvider || new FakeAIProvider();
    this.fetchImpl = options.fetchImpl || fetch;
    this.lastRunMetadata = null;
  }

  async analyzeProductImages(files, language = 'zh-TW') {
    const prompt = renderPromptByKey('analyze_product_images', { language }, fallbackPrompts.analyze_product_images);
    return this.withFallback('analyzeProductImages', [files, language], async () => {
      if (!config.geminiApiKey) throw new Error('GEMINI_API_KEY is not configured.');
      const response = await this.generateContent({
        contents: [
          {
            role: 'user',
            parts: [
              {
                text: [
                  prompt.systemPrompt || 'Analyze ecommerce product images for an ad generator.',
                  prompt.userPrompt,
                  `Output language: ${language}.`,
                  'Return only JSON with productName, title, subtitle, customPrompt, and imageRoles.',
                ].filter(Boolean).join('\n'),
              },
              ...files.slice(0, 10).map((file) => ({
                inline_data: {
                  mime_type: file.mimetype,
                  data: file.buffer.toString('base64'),
                },
              })),
            ],
          },
        ],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 512,
        },
      });
      const parsed = parseJsonFromText(extractGeminiText(response));
      const result = normalizeAnalyzeJson(parsed, files);
      result._meta = {
        provider: this.providerName,
        model: config.geminiModel,
        usage: response.usageMetadata || null,
        raw_response_json: sanitizeGeminiResponse(response),
      };
      this.lastRunMetadata = result._meta;
      return result;
    });
  }

  async ping(options = {}) {
    return this.generateText({ prompt: 'Return exactly: GEMINI_OK', model: options.model });
  }

  async generateText({ prompt, model } = {}) {
    return this.executeText({
      prompt: prompt || '',
      model,
      generationConfig: { temperature: 0.2, maxOutputTokens: 1024 },
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
      throw new Error('Gemini banner generation is scaffolded; use fake fallback until an image-capable Gemini model is configured.');
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
        model: task.resolved_model || config.geminiModel,
      });
      throwIfTextResultFailed(result, 'Gemini product copywriting failed.');
      const output = await persistProductCopyOutput(task, result.output);
      this.lastRunMetadata = normalizeTextResultMetadata(result, this.providerName, config.geminiModel);
      return [output];
    });
  }

  async generateContent(body) {
    const baseUrl = String(config.geminiBaseUrl || 'https://generativelanguage.googleapis.com').replace(/\/+$/, '');
    const model = encodeURIComponent(config.geminiModel || 'gemini-1.5-flash');
    const response = await this.fetchImpl(`${baseUrl}/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': config.geminiApiKey,
      },
      body: JSON.stringify(body),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload.error?.message || `Gemini request failed with ${response.status}`);
      error.status = response.status;
      error.code = payload.error?.status || response.status;
      throw error;
    }
    return payload;
  }

  async executeText({ prompt, model, generationConfig = {} } = {}) {
    const startedAt = Date.now();
    const selectedModel = model || config.geminiModel || 'gemini-1.5-flash';
    if (!config.geminiApiKey) {
      return this.errorResponse({
        model: selectedModel,
        startedAt,
        errorCode: 'missing_api_key',
        errorMessage: 'GEMINI_API_KEY is not configured.',
        retryable: false,
        status: null,
      });
    }
    try {
      const previousModel = config.geminiModel;
      let response;
      try {
        config.geminiModel = selectedModel;
        response = await this.generateContent({
          contents: [{ role: 'user', parts: [{ text: prompt || '' }] }],
          generationConfig,
        });
      } finally {
        config.geminiModel = previousModel;
      }
      const output = extractGeminiText(response).trim();
      return {
        ok: true,
        provider: this.providerName,
        model: selectedModel,
        output,
        usage: normalizeGeminiUsage(response.usageMetadata),
        latency_ms: Date.now() - startedAt,
        raw_response_json_safe: sanitizeGeminiResponse(response),
        error_code: null,
        error_message: null,
        retryable: false,
      };
    } catch (error) {
      return this.errorResponse({
        model: selectedModel,
        startedAt,
        errorCode: error.code || error.status || error.name || 'gemini_request_failed',
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
      usage: normalizeGeminiUsage(null),
      latency_ms: Date.now() - startedAt,
      raw_response_json_safe: null,
      error_code: String(errorCode || 'gemini_error'),
      error_message: redactSecret(errorMessage, config.geminiApiKey),
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

function normalizeGeminiUsage(usage = null) {
  return {
    input_tokens: Number(usage?.promptTokenCount || 0),
    output_tokens: Number(usage?.candidatesTokenCount || 0),
    total_tokens: Number(usage?.totalTokenCount || 0),
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
