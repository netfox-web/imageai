import OpenAI, { toFile } from 'openai';
import { config } from '../config/index.js';
import { GenerationTask, StylePreset } from '../models/index.js';
import { fallbackPrompts, renderPromptByKey, taskPromptVariables } from './PromptRenderer.js';
import { storageService } from './StorageService.js';
import { FakeAIProvider } from './FakeAIProvider.js';
import { AIProviderInterface } from './AIProviderInterface.js';
import { buildBannerPrompt as buildBannerPromptText } from './BannerPromptBuilder.js';
import { postProcessImage } from './ImagePostProcessor.js';
import {
  buildProductCopyPrompt,
  normalizeTextResultMetadata,
  persistProductCopyOutput,
  throwIfTextResultFailed,
} from './CopywritingService.js';

const defaultImageRoles = ['cover', 'scenario', 'detail', 'feature', 'multi_use'];
const supportedImageSizes = ['1024x1024', '1024x1536', '1536x1024'];

function fileToDataUrl(file) {
  return `data:${file.mimetype};base64,${file.buffer.toString('base64')}`;
}

export function extractResponseText(payload) {
  if (payload.output_text) return payload.output_text;
  if (payload.text) return payload.text;
  const output = payload.output || [];
  const content = output.flatMap((item) => item.content || []);
  const textPart = content.find((item) => item.text || item.type === 'output_text');
  return textPart?.text || payload.choices?.[0]?.message?.content || '';
}

export function parseJsonFromText(text) {
  const trimmed = String(text || '').trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced?.[1]) return JSON.parse(fenced[1].trim());
    const jsonStart = trimmed.indexOf('{');
    const jsonEnd = trimmed.lastIndexOf('}');
    if (jsonStart >= 0 && jsonEnd > jsonStart) {
      return JSON.parse(trimmed.slice(jsonStart, jsonEnd + 1));
    }
    throw new Error('OpenAI response was not valid JSON.');
  }
}

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

function sanitizeRawResponse(payload) {
  return JSON.parse(
    JSON.stringify(payload, (key, value) => {
      if (key === 'b64_json') return `[base64 omitted ${String(value || '').length} chars]`;
      if (typeof value === 'string' && value.length > 1200) return `${value.slice(0, 1200)}...[truncated]`;
      return value;
    }),
  );
}

function mergeUsage(target, usage = null) {
  if (!usage) return;
  for (const [key, value] of Object.entries(usage)) {
    if (typeof value === 'number') {
      target[key] = Number(target[key] || 0) + value;
    }
  }
}

function normalizeOpenAIUsage(usage = null) {
  return {
    input_tokens: Number(usage?.input_tokens || usage?.prompt_tokens || 0),
    output_tokens: Number(usage?.output_tokens || usage?.completion_tokens || 0),
    total_tokens: Number(usage?.total_tokens || 0),
  };
}

function isRetryableProviderError(error) {
  const status = Number(error.status || error.code || 0);
  return error.name === 'AbortError' || error.name === 'TimeoutError' || error instanceof TypeError || status === 429 || status >= 500;
}

function redactSecret(message = '', secret = '') {
  const text = String(message || '');
  return secret ? text.replaceAll(secret, '[redacted]') : text;
}

function closestSupportedSize(width, height) {
  if (config.openaiImageSize && supportedImageSizes.includes(config.openaiImageSize)) {
    return config.openaiImageSize;
  }
  if (!width || !height) return config.openaiImageSize || '1024x1024';
  const ratio = width / height;
  if (ratio > 1.2) return '1536x1024';
  if (ratio < 0.8) return '1024x1536';
  return '1024x1024';
}

function parseSize(size) {
  const [width, height] = String(size || '').split('x').map(Number);
  return { width: Number.isFinite(width) ? width : null, height: Number.isFinite(height) ? height : null };
}

function formatDescriptor(format) {
  if (format.platform_format_id) {
    return {
      label: `${format.platform_name || format.platform_key} ${format.format_name}`,
      platform_key: format.platform_key,
      platform_name: format.platform_name,
      format_name: format.format_name,
      requestedWidth: Number(format.width),
      requestedHeight: Number(format.height),
    };
  }
  return {
    label: 'Custom format',
    requestedWidth: Number(format.custom_width),
    requestedHeight: Number(format.custom_height),
  };
}

export class OpenAIProvider extends AIProviderInterface {
  providerName = 'openai';
  modelName = config.openaiImageModel;

  constructor(options = {}) {
    super();
    this.fallbackProvider = options.fallbackProvider || new FakeAIProvider();
    this.client = options.client || null;
    this.lastRunMetadata = null;
  }

  getClient() {
    if (this.client) return this.client;
    if (!config.openaiApiKey) throw new Error('OPENAI_API_KEY is not configured.');
    this.client = new OpenAI({
      apiKey: config.openaiApiKey,
      baseURL: config.openaiBaseUrl,
    });
    return this.client;
  }

  async ping(options = {}) {
    return this.generateText({ prompt: options.prompt || 'Return exactly: OPENAI_OK', model: options.model });
  }

  async generateText({ prompt = '', model = '' } = {}) {
    const startedAt = Date.now();
    const selectedModel = model || config.openaiTextModel || 'gpt-4.1-mini';
    if (!config.openaiApiKey && !this.client) {
      return this.textErrorResponse({
        model: selectedModel,
        startedAt,
        errorCode: 'missing_api_key',
        errorMessage: 'OPENAI_API_KEY is not configured.',
        retryable: false,
        status: null,
      });
    }
    try {
      const response = await this.responsesCreate({
        model: selectedModel,
        input: String(prompt || ''),
      });
      return {
        ok: true,
        provider: this.providerName,
        model: selectedModel,
        output: extractResponseText(response).trim(),
        usage: normalizeOpenAIUsage(response.usage),
        latency_ms: Date.now() - startedAt,
        raw_response_json_safe: sanitizeRawResponse(response),
        error_code: null,
        error_message: null,
        retryable: false,
        http_status: null,
      };
    } catch (error) {
      return this.textErrorResponse({
        model: selectedModel,
        startedAt,
        errorCode: error.code || error.status || error.name || 'openai_request_failed',
        errorMessage: error.message,
        retryable: isRetryableProviderError(error),
        status: error.status || null,
      });
    }
  }

  textErrorResponse({ model, startedAt, errorCode, errorMessage, retryable, status }) {
    return {
      ok: false,
      provider: this.providerName,
      model,
      output: '',
      usage: normalizeOpenAIUsage(null),
      latency_ms: Date.now() - startedAt,
      raw_response_json_safe: null,
      error_code: String(errorCode || 'openai_error'),
      error_message: redactSecret(errorMessage, config.openaiApiKey),
      retryable: Boolean(retryable),
      http_status: status,
    };
  }

  async analyzeProductImages(files, language = 'zh-TW') {
    const prompt = renderPromptByKey(
      'analyze_product_images',
      { language },
      fallbackPrompts.analyze_product_images,
    );

    return this.withFallback('analyzeProductImages', [files, language], async () => {
      const payload = {
        model: config.openaiTextModel,
        input: [
          {
            role: 'system',
            content:
              prompt.systemPrompt ||
              'You analyze ecommerce product images and return concise strict JSON for an ad generator.',
          },
          {
            role: 'user',
            content: [
              {
                type: 'input_text',
                text: [
                  prompt.userPrompt,
                  `Output language: ${language}.`,
                  'Return only JSON with productName, title, subtitle, customPrompt, and imageRoles.',
                  'imageRoles values must use cover, scenario, detail, feature, white_bg, comparison, multi_use, or info.',
                ].join('\n'),
              },
              ...files.slice(0, 10).map((file) => ({
                type: 'input_image',
                image_url: fileToDataUrl(file),
              })),
            ],
          },
        ],
      };

      const response = await this.responsesCreate(payload);
      const parsed = parseJsonFromText(extractResponseText(response));
      const result = normalizeAnalyzeJson(parsed, files);
      result._meta = {
        provider: this.providerName,
        model: config.openaiTextModel,
        usage: response.usage || null,
        raw_response_json: sanitizeRawResponse(response),
      };
      this.lastRunMetadata = result._meta;
      return result;
    });
  }

  async generateBanner(task) {
    return this.withFallback('generateBanner', [task], async () => {
      const freshTask = GenerationTask.find(task.id);
      const variables = taskPromptVariables(freshTask);
      const style = freshTask.style_key ? StylePreset.findByKey(freshTask.style_key) : null;
      const prompt = renderPromptByKey('banner_generation', variables, fallbackPrompts.banner_generation);
      const inputs = GenerationTask.images(freshTask.id, 'input');
      const formats = GenerationTask.formats(freshTask.id);
      const effectiveFormats = formats.length
        ? formats.map(formatDescriptor)
        : [{ label: 'Default square', requestedWidth: 1024, requestedHeight: 1024 }];
      const quantity = Math.min(Math.max(Number(freshTask.quantity || 1), 1), 4);
      const outputs = [];
      const rawResponses = [];
      const usageTotals = {};
      const modeRecords = [];

      for (const input of inputs.length ? inputs : [null]) {
        for (const format of effectiveFormats) {
          for (let copy = 0; copy < quantity; copy += 1) {
            const generationSize = closestSupportedSize(format.requestedWidth, format.requestedHeight);
            const promptText = this.buildBannerPrompt({
              task: freshTask,
              promptText: prompt.userPrompt,
              style,
              format,
              generationSize,
              input,
            });
            const modeResult = await this.generateImageWithMode({
              promptText,
              generationSize,
              input,
            });
            const imageResponse = modeResult.response;
            modeRecords.push({
              image_mode: modeResult.imageMode,
              used_reference_image: modeResult.usedReferenceImage,
              fallback_reason: modeResult.fallbackReason || null,
            });
            rawResponses.push({ ...modeRecords.at(-1), response: sanitizeRawResponse(imageResponse) });
            mergeUsage(usageTotals, imageResponse.usage);
            const image = imageResponse.data?.[0];
            const buffer = image?.b64_json
              ? Buffer.from(image.b64_json, 'base64')
              : await this.fetchImageBuffer(image?.url);
            const processed = await postProcessImage(buffer, {
              taskId: freshTask.id,
              format,
              index: outputs.length,
              outputFormat: 'png',
            });
            const storagePath = await storageService.putOutput(processed.buffer, processed.filename);
            const generated = parseSize(generationSize);
            outputs.push({
              storage_path: storagePath,
              width: processed.width,
              height: processed.height,
              file_size: processed.file_size,
              mime_type: processed.mime_type,
              requested_width: format.requestedWidth,
              requested_height: format.requestedHeight,
              generation_size: generationSize,
              generated_width: generated.width,
              generated_height: generated.height,
              output_format: 'png',
              transparent_background: false,
              postprocess: processed.postprocess,
            });
          }
        }
      }

      this.lastRunMetadata = {
        provider: this.providerName,
        model: config.openaiImageModel,
        image_count: outputs.length,
        usage: Object.keys(usageTotals).length ? usageTotals : null,
        cost_usd: null,
        image_mode: modeRecords.some((item) => item.image_mode === 'edit') ? 'edit' : 'generate',
        used_reference_image: modeRecords.some((item) => item.used_reference_image),
        output_format: 'png',
        transparent_background: false,
        fallback_reason: modeRecords.map((item) => item.fallback_reason).find(Boolean) || null,
        raw_response_json: {
          image_modes: modeRecords,
          requested: outputs.map((output) => ({
            requested_width: output.requested_width,
            requested_height: output.requested_height,
            generation_size: output.generation_size,
            output_format: output.output_format,
            transparent_background: output.transparent_background,
            postprocess: output.postprocess,
          })),
          responses: rawResponses,
        },
      };

      return outputs;
    });
  }

  async generateImageWithMode({ promptText, generationSize, input }) {
    const configuredMode = String(config.openaiImageMode || 'auto').toLowerCase();
    const canUseReference = Boolean(input?.storage_path);
    const shouldTryEdit = configuredMode === 'edit' || (configuredMode === 'auto' && canUseReference);
    const generate = () =>
      this.imagesGenerate({
        model: config.openaiImageModel,
        prompt: promptText,
        size: generationSize,
        n: 1,
        output_format: 'png',
      });

    if (!shouldTryEdit) {
      return {
        response: await generate(),
        imageMode: 'generate',
        usedReferenceImage: false,
        fallbackReason: configuredMode === 'edit' && !canUseReference ? 'No reference image available.' : null,
      };
    }

    try {
      const referenceBuffer = await storageService.read(input.storage_path);
      const referenceFile = await toFile(referenceBuffer, `task-reference-${input.id || Date.now()}.png`, {
        type: input.mime_type || 'image/png',
      });
      return {
        response: await this.imagesEdit({
          model: config.openaiImageModel,
          image: referenceFile,
          prompt: [
            promptText,
            'Reference edit instruction: preserve the exact product from the supplied image. Do not alter logos, labels, colors, shape, proportions, or packaging. Change background, composition, lighting, and ad layout only.',
          ].join('\n'),
          size: generationSize,
          n: 1,
          output_format: 'png',
          input_fidelity: 'high',
        }),
        imageMode: 'edit',
        usedReferenceImage: true,
        fallbackReason: null,
      };
    } catch (error) {
      if (config.aiStrictProvider) throw error;
      return {
        response: await generate(),
        imageMode: 'generate',
        usedReferenceImage: false,
        fallbackReason: `reference edit failed: ${error.message}`,
      };
    }
  }

  buildBannerPrompt({ task, promptText, style, format, generationSize }) {
    return buildBannerPromptText({ task, promptText, style, format, generationSize });
  }

  async translateImage(task) {
    return this.fallbackProvider.translateImage(task);
  }

  async cutoutImage(task) {
    return this.withFallback('cutoutImage', [task], async () => {
      const startedAt = Date.now();
      const freshTask = GenerationTask.find(task.id) || task;
      const inputs = GenerationTask.images(freshTask.id, 'input');
      const outputs = [];
      const rawResponses = [];
      const usageTotals = {};

      for (let index = 0; index < inputs.length; index += 1) {
        const input = inputs[index];
        const generationSize = closestSupportedSize(input.width, input.height);
        const referenceBuffer = await storageService.read(input.storage_path);
        const referenceFile = await toFile(referenceBuffer, `task-cutout-${input.id || Date.now()}.png`, {
          type: input.mime_type || 'image/png',
        });
        const response = await this.imagesEdit({
          model: config.openaiImageModel,
          image: referenceFile,
          prompt: [
            'Remove the background from the uploaded product or subject image.',
            'Preserve the original subject exactly, including edges, colors, logos, labels, texture, proportions, and shadows when useful.',
            'Return a clean transparent-background PNG only.',
          ].join('\n'),
          size: generationSize,
          n: 1,
          background: 'transparent',
          output_format: 'png',
          input_fidelity: 'high',
        });

        rawResponses.push(sanitizeRawResponse(response));
        mergeUsage(usageTotals, response.usage);
        const image = response.data?.[0];
        const buffer = image?.b64_json
          ? Buffer.from(image.b64_json, 'base64')
          : await this.fetchImageBuffer(image?.url);
        const processed = await postProcessImage(buffer, {
          taskId: freshTask.id,
          format: {
            label: 'Smart background removal',
            requestedWidth: input.width || null,
            requestedHeight: input.height || null,
          },
          index,
          outputFormat: 'png',
        });
        const storagePath = await storageService.putOutput(processed.buffer, processed.filename);
        const generated = parseSize(generationSize);
        outputs.push({
          storage_path: storagePath,
          width: processed.width,
          height: processed.height,
          file_size: processed.file_size,
          mime_type: processed.mime_type,
          requested_width: input.width || null,
          requested_height: input.height || null,
          generation_size: generationSize,
          generated_width: generated.width,
          generated_height: generated.height,
          output_format: 'png',
          transparent_background: true,
          image_mode: 'edit',
          used_reference_image: true,
          postprocess: processed.postprocess,
        });
      }

      this.lastRunMetadata = {
        provider: this.providerName,
        model: config.openaiImageModel,
        image_count: outputs.length,
        usage: Object.keys(usageTotals).length ? usageTotals : null,
        cost_usd: null,
        latency_ms: Date.now() - startedAt,
        image_mode: 'edit',
        used_reference_image: true,
        output_format: 'png',
        transparent_background: true,
        edit_options: {
          background: 'transparent',
          output_format: 'png',
          input_fidelity: 'high',
        },
        raw_response_json: {
          requested: outputs.map((output) => ({
            requested_width: output.requested_width,
            requested_height: output.requested_height,
            generation_size: output.generation_size,
            output_format: output.output_format,
            transparent_background: output.transparent_background,
            postprocess: output.postprocess,
          })),
          responses: rawResponses,
        },
      };

      return outputs;
    });
  }

  async removeText(task) {
    return this.fallbackProvider.removeText(task);
  }

  async generateProductCopy(task) {
    return this.withFallback('generateProductCopy', [task], async () => {
      const freshTask = GenerationTask.find(task.id) || task;
      const result = await this.generateText({
        prompt: buildProductCopyPrompt(freshTask),
        model: freshTask.resolved_model || config.openaiTextModel,
      });
      throwIfTextResultFailed(result, 'OpenAI product copywriting failed.');
      const output = await persistProductCopyOutput(freshTask, result.output);
      this.lastRunMetadata = normalizeTextResultMetadata(result, this.providerName, config.openaiTextModel);
      return [output];
    });
  }

  async responsesCreate(payload) {
    return this.getClient().responses.create(payload);
  }

  async imagesGenerate(payload) {
    return this.getClient().images.generate(payload);
  }

  async imagesEdit(payload) {
    return this.getClient().images.edit(payload);
  }

  async fetchImageBuffer(url) {
    if (!url) throw new Error('OpenAI image response did not include image data.');
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Failed to fetch generated image: ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
  }

  consumeLastRunMetadata() {
    const metadata = this.lastRunMetadata;
    this.lastRunMetadata = null;
    return metadata;
  }

  async withFallback(method, args, callback) {
    try {
      return await callback();
    } catch (error) {
      if (config.aiStrictProvider) throw error;
      const result = await this.fallbackProvider[method](...args);
      const metadata = {
        provider: 'fake',
        model: 'fake',
        fallback_from: this.providerName,
        fallback_used: true,
        fallback_reason: error.message,
        error: error.message,
        error_code: error.code || error.name || 'provider_error',
      };
      this.lastRunMetadata = metadata;
      if (result && typeof result === 'object' && !Array.isArray(result)) {
        result._meta = metadata;
      }
      return result;
    }
  }
}
