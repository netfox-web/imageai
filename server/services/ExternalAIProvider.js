import { config } from '../config/index.js';
import { GenerationTask } from '../models/index.js';
import { fallbackPrompts, renderPromptByKey, taskPromptVariables } from './PromptRenderer.js';
import { storageService } from './StorageService.js';
import { FakeAIProvider } from './FakeAIProvider.js';
import { AIProviderInterface } from './AIProviderInterface.js';

export class ExternalAIProvider extends AIProviderInterface {
  providerName = 'external';
  modelName = 'external';

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
      throw new Error(payload.message || `External AI request failed with ${response.status}`);
    }
    return payload;
  }

  async withFallback(method, args, callback) {
    try {
      return await callback();
    } catch (error) {
      if (config.aiStrictProvider) throw error;
      return this.fallbackProvider[method](...args);
    }
  }
}
