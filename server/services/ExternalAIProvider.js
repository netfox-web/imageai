import { config } from '../config/index.js';
import { GenerationTask } from '../models/index.js';
import { fallbackPrompts, renderPromptByKey, taskPromptVariables } from './PromptRenderer.js';
import { storageService, storageUrl } from './StorageService.js';
import { FakeAIProvider } from './FakeAIProvider.js';
import { AIProviderInterface } from './AIProviderInterface.js';

export class ExternalAIProvider extends AIProviderInterface {
  providerName = 'external';
  modelName = 'external';
  lastRunMetadata = null;

  constructor(fallbackProvider = new FakeAIProvider()) {
    super();
    this.fallbackProvider = fallbackProvider;
  }

  async analyzeProductImages(files, language = 'zh-TW') {
    const prompt = renderPromptByKey('analyze_product_images', { language }, fallbackPrompts.analyze_product_images);
    return this.withFallback('analyzeProductImages', [files, language], async () => {
      const response = await this.request('/analyze', {
        language,
        prompt: prompt.userPrompt,
        images: files.map((file) => ({
          filename: file.originalname,
          mime_type: file.mimetype,
          base64: file.buffer.toString('base64'),
        })),
      });
      return {
        productName: response.productName || response.product_name,
        title: response.title,
        subtitle: response.subtitle,
        customPrompt: response.customPrompt || response.custom_prompt,
        imageRoles: response.imageRoles || response.image_roles || files.map((_, index) => (index === 0 ? 'cover' : 'multi_use')),
      };
    });
  }

  async generateBanner(task) {
    return this.withFallback('generateBanner', [task], async () => {
      const freshTask = GenerationTask.find(task.id);
      const prompt = renderPromptByKey('banner_generation', taskPromptVariables(freshTask), fallbackPrompts.banner_generation);
      const response = await this.request('/banner', {
        task: freshTask,
        prompt: prompt.userPrompt,
        formats: GenerationTask.formats(freshTask.id),
      });

      if (!Array.isArray(response.outputs) || !response.outputs.length) {
        throw new Error('External provider did not return outputs.');
      }

      const outputs = [];
      for (let index = 0; index < response.outputs.length; index += 1) {
        const output = response.outputs[index];
        if (output.storage_path) {
          outputs.push(output);
          continue;
        }
        if (!output.base64) throw new Error('External output must include base64 or storage_path.');
        const buffer = Buffer.from(output.base64, 'base64');
        const storagePath = await storageService.putOutput(buffer, `task-${freshTask.id}-external-${Date.now()}-${index}.png`);
        outputs.push({
          storage_path: storagePath,
          width: output.width || null,
          height: output.height || null,
          file_size: buffer.length,
          mime_type: output.mime_type || 'image/png',
        });
      }

      return outputs;
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

  async generatePost(task) {
    return this.withFallback('generatePost', [task], async () => {
      const response = await this.request('/post', {
        task,
        metadata: parseTaskMetadata(task),
      });
      return [
        {
          kind: 'text',
          title: response.title || 'Generated post',
          content_text: response.content_text || response.content || response.output || '',
          mime_type: 'text/plain',
          visibility: 'private',
          metadata: response.metadata || {},
        },
      ];
    });
  }

  async mixImages(task) {
    return this.withFallback('mixImages', [task], async () => {
      const response = await this.request('/image-mix', {
        task,
        images: GenerationTask.images(task.id, 'input'),
        metadata: parseTaskMetadata(task),
      });
      return this.normalizeExternalOutputs(response, task.id, 'image-mix');
    });
  }

  async imageToVideo(task) {
    return this.withFallback('imageToVideo', [task], async () => {
      const freshTask = GenerationTask.find(task.id) || task;
      const metadata = parseTaskMetadata(freshTask);
      const prompt = videoPrompt(freshTask, metadata);
      const options = videoOptions(freshTask, metadata);
      const inputImages = await externalInputImages(freshTask);
      const startedAt = Date.now();
      let response;

      try {
        response = await this.request('/image-to-video', {
          task_id: freshTask.id,
          tool_type: 'image_to_video',
          prompt,
          input_images: inputImages,
          options,
        });
      } catch (error) {
        throw externalProviderFailed(error.message);
      }

      const rawResponseSafe = sanitizeExternalPayload(response);
      const artifacts = normalizeImageToVideoArtifacts(response, {
        prompt,
        options,
        rawResponseSafe,
      });

      this.lastRunMetadata = {
        provider: this.providerName,
        model: this.modelName,
        image_count: inputImages.length,
        artifact_count: artifacts.length,
        cost_usd: null,
        media_mode: 'external_image_to_video',
        latency_ms: Date.now() - startedAt,
        raw_response_json: rawResponseSafe,
      };

      return {
        outputs: this.normalizeExternalOutputRows(response.outputs || []),
        artifacts,
      };
    });
  }

  async transformSensitiveMedia(task) {
    return this.withFallback('transformSensitiveMedia', [task], async () => {
      const response = await this.request('/sensitive-media', {
        task,
        images: GenerationTask.images(task.id, 'input'),
        metadata: parseTaskMetadata(task),
        consent: {
          granted: Boolean(task.consent_granted),
          statement: task.consent_statement || '',
          privacy_mode: 'private',
        },
      });
      return {
        outputs: this.normalizeExternalOutputRows(response.outputs || []),
        artifacts: (response.artifacts || []).map((artifact) => ({ ...artifact, visibility: 'private' })),
      };
    });
  }

  normalizeExternalOutputRows(outputs = []) {
    return outputs.filter((output) => output.storage_path);
  }

  async normalizeExternalOutputs(response, taskId, label) {
    if (!Array.isArray(response.outputs) || !response.outputs.length) {
      throw new Error('External provider did not return outputs.');
    }
    const outputs = [];
    for (let index = 0; index < response.outputs.length; index += 1) {
      const output = response.outputs[index];
      if (output.storage_path) {
        outputs.push(output);
        continue;
      }
      if (!output.base64) throw new Error('External output must include base64 or storage_path.');
      const buffer = Buffer.from(output.base64, 'base64');
      const storagePath = await storageService.putOutput(buffer, `task-${taskId}-${label}-${Date.now()}-${index}.png`);
      outputs.push({
        storage_path: storagePath,
        width: output.width || null,
        height: output.height || null,
        file_size: buffer.length,
        mime_type: output.mime_type || 'image/png',
      });
    }
    return outputs;
  }

  async request(endpoint, body) {
    if (!config.externalAiBaseUrl) {
      throw new Error('EXTERNAL_AI_BASE_URL is not configured.');
    }

    const response = await fetch(`${config.externalAiBaseUrl.replace(/\/$/, '')}${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(config.externalAiApiKey ? { Authorization: `Bearer ${config.externalAiApiKey}` } : {}),
      },
      body: JSON.stringify(body),
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload.message || `External AI request failed with ${response.status}`);
      error.status = response.status;
      error.code = payload.code || 'external_provider_failed';
      error.retryable = false;
      throw error;
    }
    return payload;
  }

  async withFallback(method, args, callback) {
    try {
      return await callback();
    } catch (error) {
      if (method === 'imageToVideo') throw error;
      if (config.aiStrictProvider) throw error;
      return this.fallbackProvider[method](...args);
    }
  }

  consumeLastRunMetadata() {
    const metadata = this.lastRunMetadata;
    this.lastRunMetadata = null;
    return metadata;
  }
}

function parseTaskMetadata(task) {
  try {
    return JSON.parse(task.input_metadata_json || '{}');
  } catch {
    return {};
  }
}

function videoPrompt(task, metadata = {}) {
  return (
    metadata.prompt ||
    metadata.video_prompt ||
    task.custom_prompt ||
    task.main_title ||
    task.product_name ||
    'Create a short product video from the supplied image.'
  );
}

function videoOptions(task, metadata = {}) {
  const duration = Number(metadata.duration_seconds || metadata.duration || metadata.seconds || 5);
  return {
    duration: Number.isFinite(duration) && duration > 0 ? duration : 5,
    duration_seconds: Number.isFinite(duration) && duration > 0 ? duration : 5,
    aspect_ratio: metadata.aspect_ratio || metadata.aspectRatio || '1:1',
    language: task.language || metadata.language || 'zh-TW',
    motion: metadata.motion || metadata.camera_motion || null,
  };
}

async function externalInputImages(task) {
  const images = GenerationTask.images(task.id, 'input');
  const packed = [];
  for (const image of images) {
    const mimeType = image.mime_type || 'image/png';
    const input = {
      id: image.id,
      role: image.role || null,
      storage_path: image.storage_path,
      url: image.storage_path ? storageUrl(image.storage_path) : null,
      mime_type: mimeType,
    };
    if (image.storage_path) {
      const buffer = await storageService.read(image.storage_path);
      input.base64 = buffer.toString('base64');
      input.data_url = `data:${mimeType};base64,${input.base64}`;
    }
    packed.push(input);
  }
  return packed;
}

function normalizeImageToVideoArtifacts(response, context) {
  if (!response || response.ok === false) {
    throw externalProviderFailed(response?.message);
  }

  const providerJobId = response.provider_job_id || response.job_id || response.id || null;
  const responseArtifacts = Array.isArray(response.artifacts) ? response.artifacts : [];
  const candidateArtifacts = responseArtifacts.length
    ? responseArtifacts
    : [
        {
          type: 'video',
          title: response.title || 'Generated video',
          url: response.video_url || response.url || response.external_url || response.external_ref || '',
          storage_path: response.storage_path || null,
          mime_type: response.mime_type || 'video/mp4',
          duration_seconds: response.duration_seconds || null,
          provider_job_id: providerJobId,
          metadata: response.metadata || {},
        },
      ];

  const artifacts = candidateArtifacts
    .map((artifact, index) => normalizeVideoArtifact(artifact, index, providerJobId, context))
    .filter((artifact) => String(artifact.kind || '').toLowerCase() === 'video' && (artifact.content_text || artifact.storage_path));

  if (!artifacts.length) {
    throw externalProviderFailed(response.message);
  }

  return artifacts;
}

function normalizeVideoArtifact(artifact = {}, index, responseProviderJobId, context) {
  const url = artifact.video_url || artifact.url || artifact.external_url || artifact.external_ref || artifact.content_text || '';
  const providerJobId = artifact.provider_job_id || responseProviderJobId || null;
  const duration = Number(artifact.duration_seconds ?? artifact.duration ?? context.options.duration_seconds);
  return {
    kind: artifact.kind || artifact.type || 'video',
    title: artifact.title || (index === 0 ? 'Generated video' : `Generated video ${index + 1}`),
    content_text: url || null,
    storage_path: artifact.storage_path || null,
    mime_type: artifact.mime_type || 'video/mp4',
    visibility: 'private',
    metadata: {
      ...(artifact.metadata || {}),
      artifact_type: 'video',
      source: 'external',
      provider: 'external',
      provider_job_id: providerJobId,
      external_url: url || null,
      url: url || null,
      duration_seconds: Number.isFinite(duration) ? duration : null,
      prompt: context.prompt,
      options: context.options,
      raw_response_safe: context.rawResponseSafe,
    },
  };
}

function externalProviderFailed(detail = '') {
  const error = new Error('外部圖生影片供應商未回傳可用影片，未產生結果，點數已退回。');
  error.code = 'external_provider_failed';
  error.retryable = false;
  if (detail) error.provider_detail = String(detail);
  return error;
}

function sanitizeExternalPayload(value, depth = 0) {
  if (depth > 6) return '[truncated]';
  if (Array.isArray(value)) return value.map((item) => sanitizeExternalPayload(item, depth + 1));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => {
        const normalized = key.toLowerCase();
        if (normalized.includes('authorization') || normalized.includes('api_key') || normalized.includes('apikey') || normalized.includes('secret') || normalized.includes('token')) {
          return [key, '[redacted]'];
        }
        if (normalized === 'base64' || normalized === 'data_url' || normalized === 'data') {
          return [key, '[omitted]'];
        }
        return [key, sanitizeExternalPayload(item, depth + 1)];
      }),
    );
  }
  if (typeof value === 'string' && value.length > 1200) {
    return `${value.slice(0, 1200)}...[truncated]`;
  }
  return value;
}
