import { now } from '../db/database.js';
import { AiCostLog, GenerationTask, TaskImage } from '../models/index.js';
import { config } from '../config/index.js';
import { resolveAIProvider } from '../services/AIProviderFactory.js';
import { recordTaskFailure } from '../services/TaskFailurePolicy.js';

export class GenerateTaskJob {
  static queue = [];
  static working = false;

  static dispatch(taskId) {
    this.queue.push(Number(taskId));
    setTimeout(() => this.work(), 25);
  }

  static async work() {
    if (this.working) return;
    this.working = true;
    try {
      while (this.queue.length) {
        const taskId = this.queue.shift();
        await this.handle(taskId);
      }
    } finally {
      this.working = false;
    }
  }

  static async handle(taskId) {
    const task = GenerationTask.find(taskId);
    if (!task || task.status === 'success') return;
    const jobStartedAt = Date.now();
    let providerName = 'unknown';
    let modelName = 'unknown';

    try {
      GenerationTask.update(task.id, {
        status: 'processing',
        started_at: now(),
        processing_started_at: now(),
        error_message: null,
      });

      if (String(task.custom_prompt || '').includes('__FAKE_FAIL__')) {
        const error = new Error('FakeAIProvider forced failure.');
        error.code = 'validation_error';
        error.retryable = false;
        throw error;
      }

      if (String(task.custom_prompt || '').includes('__RETRYABLE_FAIL__')) {
        const error = new Error('Simulated storage retryable failure.');
        error.code = 'storage_error';
        error.retryable = true;
        throw error;
      }

      const provider = resolveAIProvider(task.resolved_provider || config.aiProvider);
      providerName = provider.providerName || 'unknown';
      modelName = provider.modelName || providerName;
      const freshTask = GenerationTask.find(task.id);
      let outputs = [];

      if (freshTask.tool_type === 'banner') {
        outputs = await provider.generateBanner(freshTask);
      } else if (freshTask.tool_type === 'translation') {
        outputs = await provider.translateImage(freshTask);
      } else if (freshTask.tool_type === 'cutout') {
        outputs = await provider.cutoutImage(freshTask);
      } else if (freshTask.tool_type === 'removal') {
        outputs = await provider.removeText(freshTask);
      } else {
        throw new Error(`Unsupported tool_type: ${freshTask.tool_type}`);
      }

      const runMetadata = provider.consumeLastRunMetadata?.() || {};
      const latencyMs = Number(runMetadata.latency_ms || Date.now() - jobStartedAt);
      const selectionFallback = Boolean(freshTask.fallback_reason && freshTask.resolved_provider === 'fake' && freshTask.requested_provider && freshTask.requested_provider !== 'fake');
      const fallbackUsed = Boolean(runMetadata.fallback_from || runMetadata.fallback_used || selectionFallback);
      const fallbackReason = runMetadata.fallback_reason || freshTask.fallback_reason || runMetadata.error || null;

      outputs.forEach((image, index) => {
        TaskImage.create({
          task_id: freshTask.id,
          type: 'output',
          role: null,
          storage_path: image.storage_path,
          width: image.width || null,
          height: image.height || null,
          file_size: image.file_size || null,
          mime_type: image.mime_type || null,
          sort_order: index,
        });
      });

      AiCostLog.create({
        task_id: freshTask.id,
        provider: runMetadata.provider || provider.providerName || 'unknown',
        model: runMetadata.model || provider.modelName || provider.providerName || 'unknown',
        input_tokens: runMetadata.usage?.input_tokens || runMetadata.usage?.prompt_tokens || null,
        output_tokens: runMetadata.usage?.output_tokens || runMetadata.usage?.completion_tokens || null,
        image_count: outputs.length,
        cost_usd: runMetadata.cost_usd ?? (runMetadata.provider === 'fake' || provider.providerName === 'fake' ? 0 : null),
        raw_response_json: JSON.stringify({
          outputCount: outputs.length,
          provider: runMetadata.provider || provider.providerName || 'unknown',
          model: runMetadata.model || provider.modelName || provider.providerName || 'unknown',
          image_count: outputs.length,
          usage: runMetadata.usage || null,
          estimated_cost: runMetadata.estimated_cost ?? runMetadata.cost_usd ?? null,
          cost: runMetadata.cost_usd ?? null,
          storage_disk: config.filesystemDisk,
          image_mode: runMetadata.image_mode || null,
          used_reference_image: Boolean(runMetadata.used_reference_image),
          fallback_used: fallbackUsed,
          fallback_from: runMetadata.fallback_from || null,
          fallback_reason: fallbackReason,
          requested_provider: freshTask.requested_provider || null,
          resolved_provider: freshTask.resolved_provider || provider.providerName || null,
          requested_model: freshTask.requested_model || null,
          resolved_model: freshTask.resolved_model || runMetadata.model || provider.modelName || null,
          requested_capability: freshTask.requested_capability || null,
          provider_config_source: freshTask.provider_config_source || null,
          provider_selection_reason: freshTask.provider_selection_reason || null,
          quality_review_required: Boolean(freshTask.quality_review_required),
          latency_ms: latencyMs,
          error_code: runMetadata.error_code || null,
          error_message: runMetadata.error_message || runMetadata.error || null,
          requested: outputs.map((image) => ({
            requested_width: image.requested_width || null,
            requested_height: image.requested_height || null,
            generation_size: image.generation_size || null,
            postprocess: image.postprocess || null,
          })),
          raw: runMetadata.raw_response_json || null,
          error: runMetadata.error || null,
        }),
      });

      GenerationTask.update(freshTask.id, {
        status: 'success',
        finished_at: now(),
        completed_at: now(),
        last_error_code: null,
        last_error_message: null,
      });
    } catch (error) {
      const latencyMs = Date.now() - jobStartedAt;
      recordTaskFailure(task, error, {
        providerName,
        modelName,
        latencyMs,
        inputCount: GenerationTask.images(task.id, 'input').length,
      });
    }
  }
}
