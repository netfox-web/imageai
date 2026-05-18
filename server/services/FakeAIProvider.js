import path from 'node:path';
import { AIProviderInterface } from './AIProviderInterface.js';
import { GenerationTask } from '../models/index.js';
import { storageService } from './StorageService.js';

const roleCycle = ['cover', 'scenario', 'detail', 'feature', 'white_bg', 'comparison', 'multi_use', 'info'];

function outputFilename(taskId, inputImage, index) {
  const ext = path.extname(inputImage.storage_path) || '.png';
  return `task-${taskId}-${Date.now()}-${index}${ext}`;
}

async function copyInputToOutput(task, inputImage, index) {
  const buffer = storageService.read(inputImage.storage_path);
  const storagePath = await storageService.putOutput(buffer, outputFilename(task.id, inputImage, index));
  return {
    storage_path: storagePath,
    width: inputImage.width,
    height: inputImage.height,
    file_size: buffer.length,
    mime_type: inputImage.mime_type,
  };
}

export class FakeAIProvider extends AIProviderInterface {
  providerName = 'fake';
  modelName = 'fake';
  lastRunMetadata = null;

  async analyzeProductImages(files, language = 'zh-TW') {
    const result = {
      productName: language === 'en' ? 'Smart Product Name' : '智能商品名稱',
      title: language === 'en' ? 'Instantly Eye-Catching' : '吸睛主標語',
      subtitle: language === 'en' ? 'A short conversion-focused subtitle' : '簡短副標語',
      customPrompt:
        language === 'en'
          ? 'Bright and clean ecommerce ad background that highlights the product.'
          : '明亮乾淨的電商廣告背景，突出商品主體',
      imageRoles: files.map((_, index) => roleCycle[index % roleCycle.length]),
    };
    this.lastRunMetadata = { provider: this.providerName, model: this.modelName, image_count: files.length, cost_usd: 0 };
    result._meta = this.lastRunMetadata;
    return result;
  }

  async ping(options = {}) {
    return this.generateText({ prompt: options.prompt || 'Return exactly: FAKE_OK', model: options.model });
  }

  async generateText({ prompt = '', model = 'fake' } = {}) {
    const startedAt = Date.now();
    return {
      ok: true,
      provider: this.providerName,
      model: model || this.modelName,
      output: String(prompt || '').includes('Return exactly') ? 'FAKE_OK' : `fake response: ${String(prompt || '').slice(0, 160)}`,
      usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
      latency_ms: Date.now() - startedAt,
      raw_response_json_safe: { provider: this.providerName, model: model || this.modelName, fake: true },
      error_code: null,
      error_message: null,
      retryable: false,
      http_status: null,
    };
  }

  async generateBanner(task) {
    const inputs = GenerationTask.images(task.id, 'input');
    const formats = GenerationTask.formats(task.id);
    const quantity = Math.min(Math.max(Number(task.quantity || 1), 1), 4);
    const totalCopies = Math.max(1, formats.length || 1) * quantity;
    const outputs = [];
    let index = 0;

    for (const input of inputs) {
      for (let copy = 0; copy < totalCopies; copy += 1) {
        outputs.push(await copyInputToOutput(task, input, index));
        index += 1;
      }
    }

    this.lastRunMetadata = { provider: this.providerName, model: this.modelName, image_count: outputs.length, cost_usd: 0 };
    return outputs;
  }

  async translateImage(task) {
    return this.copyAllInputs(task);
  }

  async cutoutImage(task) {
    return this.copyAllInputs(task);
  }

  async removeText(task) {
    return this.copyAllInputs(task);
  }

  async generatePost(task) {
    const metadata = parseTaskMetadata(task);
    const channel = metadata.channel || metadata.platform || 'social';
    const tone = metadata.tone || 'brand-safe';
    const productName = task.product_name || metadata.product_name || 'Product';
    const title = task.main_title || 'Fresh campaign idea';
    const output = [
      `${title}`,
      '',
      `${productName}: ${task.subtitle || 'A concise post generated through the task queue.'}`,
      '',
      `Tone: ${tone}`,
      `Channel: ${channel}`,
      '#adstudio #branddna',
    ].join('\n');
    this.lastRunMetadata = {
      provider: this.providerName,
      model: this.modelName,
      image_count: 0,
      artifact_count: 1,
      cost_usd: 0,
      media_mode: 'post_generator',
    };
    return [
      {
        kind: 'text',
        title: `${channel} post`,
        content_text: output,
        mime_type: 'text/plain',
        visibility: 'private',
        metadata: { channel, tone, fake: true },
      },
    ];
  }

  async mixImages(task) {
    const outputs = await this.copyAllInputs(task);
    this.lastRunMetadata = {
      provider: this.providerName,
      model: this.modelName,
      image_count: outputs.length,
      cost_usd: 0,
      image_mode: 'fake_image_mix',
    };
    return outputs;
  }

  async imageToVideo(task) {
    const previews = await this.copyAllInputs(task);
    const metadata = parseTaskMetadata(task);
    this.lastRunMetadata = {
      provider: this.providerName,
      model: this.modelName,
      image_count: previews.length,
      artifact_count: 1,
      cost_usd: 0,
      media_mode: 'fake_image_to_video',
    };
    return {
      outputs: previews,
      artifacts: [
        {
          kind: 'video',
          title: 'Image-to-video job',
          content_text: 'Fake provider video placeholder. Replace with an external/generated video URL when a live video provider is configured.',
          mime_type: 'application/json',
          visibility: 'private',
          metadata: {
            duration_seconds: Number(metadata.duration_seconds || 5),
            motion: metadata.motion || 'subtle product camera move',
            fake: true,
          },
        },
      ],
    };
  }

  async transformSensitiveMedia(task) {
    const metadata = parseTaskMetadata(task);
    this.lastRunMetadata = {
      provider: this.providerName,
      model: this.modelName,
      image_count: 0,
      artifact_count: 1,
      cost_usd: 0,
      media_mode: 'sensitive_media_placeholder',
    };
    return {
      outputs: [],
      artifacts: [
        {
          kind: task.tool_type === 'voice_clone' ? 'audio' : 'video',
          title: `${task.tool_type} private result`,
          content_text: 'Sensitive media task accepted with consent and kept private by default.',
          mime_type: 'application/json',
          visibility: 'private',
          metadata: {
            tool_type: task.tool_type,
            consent_required: true,
            privacy_mode: 'private',
            subject: metadata.subject || '',
            fake: true,
          },
        },
      ],
    };
  }

  async copyAllInputs(task) {
    const outputs = [];
    const inputs = GenerationTask.images(task.id, 'input');
    for (let index = 0; index < inputs.length; index += 1) {
      outputs.push(await copyInputToOutput(task, inputs[index], index));
    }
    this.lastRunMetadata = { provider: this.providerName, model: this.modelName, image_count: outputs.length, cost_usd: 0 };
    return outputs;
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
