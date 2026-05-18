import { now } from '../db/database.js';
import { AiCostLog, GenerationTask, TaskImage } from '../models/index.js';
import { config } from '../config/index.js';
import { resolveAIProvider } from '../services/AIProviderFactory.js';
import { recordTaskFailure } from '../services/TaskFailurePolicy.js';

function inferOutputFormat(output = {}, runMetadata = {}) {
  if (runMetadata.output_format) return runMetadata.output_format;
  if (output.output_format) return output.output_format;
  const mimeType = String(output.mime_type || '');
  if (mimeType.includes('/')) return mimeType.split('/').pop();
  return null;
}

function buildOutputTrace(output = {}, index = 0, runMetadata = {}) {
  return {
    index,
    storage_path: output.storage_path || null,
    mime_type: output.mime_type || null,
    width: output.width || null,
    height: output.height || null,
    file_size: output.file_size || null,
    output_format: inferOutputFormat(output, runMetadata),
    transparent_background: Boolean(output.transparent_background ?? runMetadata.transparent_background),
    image_mode: output.image_mode || runMetadata.image_mode || null,
    used_reference_image: Boolean(output.used_reference_image ?? runMetadata.used_reference_image),
    requested_width: output.requested_width || null,
    requested_height: output.requested_height || null,
    generation_size: output.generation_size || null,
    postprocess: output.postprocess || null,
  };
}

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
      } else if (freshTask.tool_type === 'copywriting') {
        outputs = await provider.generateProductCopy(freshTask);
      } else {
        throw new Error(`Unsupported tool_type: ${freshTask.tool_type}`);
      }

      const runMetadata = provider.consumeLastRunMetadata?.() || {};
      const loggedImageCount = Number.isFinite(Number(runMetadata.image_count)) ? Number(runMetadata.image_count) : outputs.length;
      const latencyMs = Number(runMetadata.latency_ms || Date.now() - jobStartedAt);
      const selectionFallback = Boolean(freshTask.fallback_reason && freshTask.resolved_provider === 'fake' && freshTask.requested_provider && freshTask.requested_provider !== 'fake');
      const fallbackUsed = Boolean(runMetadata.fallback_from || runMetadata.fallback_used || selectionFallback);
      const fallbackReason = runMetadata.fallback_reason || freshTask.fallback_reason || runMetadata.error || null;
      const outputTraces = outputs.map((output, index) => buildOutputTrace(output, index, runMetadata));
      const firstOutput = outputTraces[0] || {};
      const providerTrace = {
        requested_provider: freshTask.requested_provider || null,
        resolved_provider: freshTask.resolved_provider || provider.providerName || null,
        effective_provider: runMetadata.provider || provider.providerName || 'unknown',
        requested_model: freshTask.requested_model || null,
        resolved_model: freshTask.resolved_model || runMetadata.model || provider.modelName || null,
        effective_model: runMetadata.model || provider.modelName || provider.providerName || 'unknown',
        requested_capability: freshTask.requested_capability || null,
        provider_config_source: freshTask.provider_config_source || null,
        provider_selection_reason: freshTask.provider_selection_reason || null,
        fallback_used: fallbackUsed,
        fallback_from: runMetadata.fallback_from || null,
        fallback_reason: fallbackReason,
      };

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
        image_count: loggedImageCount,
        cost_usd: runMetadata.cost_usd ?? (runMetadata.provider === 'fake' || provider.providerName === 'fake' ? 0 : null),
        raw_response_json: JSON.stringify({
          outputCount: outputs.length,
          provider: runMetadata.provider || provider.providerName || 'unknown',
          model: runMetadata.model || provider.modelName || provider.providerName || 'unknown',
          image_count: loggedImageCount,
          output_type: runMetadata.output_type || (freshTask.tool_type === 'copywriting' ? 'copywriting' : 'image'),
          output_format: runMetadata.output_format || firstOutput.output_format || null,
          transparent_background: Boolean(runMetadata.transparent_background || outputTraces.some((output) => output.transparent_background)),
          outputs: outputTraces,
          edit_options: runMetadata.edit_options || null,
          usage: runMetadata.usage || null,
          estimated_cost: runMetadata.estimated_cost ?? runMetadata.cost_usd ?? null,
          cost: runMetadata.cost_usd ?? null,
          storage_disk: config.filesystemDisk,
          image_mode: runMetadata.image_mode || firstOutput.image_mode || null,
          used_reference_image: Boolean(runMetadata.used_reference_image || outputTraces.some((output) => output.used_reference_image)),
          fallback_used: fallbackUsed,
          fallback_from: runMetadata.fallback_from || null,
          fallback_reason: fallbackReason,
          requested_provider: freshTask.requested_provider || null,
          resolved_provider: freshTask.resolved_provider || provider.providerName || null,
          effective_provider: runMetadata.provider || provider.providerName || 'unknown',
          requested_model: freshTask.requested_model || null,
          resolved_model: freshTask.resolved_model || runMetadata.model || provider.modelName || null,
          effective_model: runMetadata.model || provider.modelName || provider.providerName || 'unknown',
          requested_capability: freshTask.requested_capability || null,
          provider_config_source: freshTask.provider_config_source || null,
          provider_selection_reason: freshTask.provider_selection_reason || null,
          provider_trace: providerTrace,
          quality_review_required: Boolean(freshTask.quality_review_required),
          latency_ms: latencyMs,
          error_code: runMetadata.error_code || null,
          error_message: runMetadata.error_message || runMetadata.error || null,
          requested: outputs.map((image) => ({
            requested_width: image.requested_width || null,
            requested_height: image.requested_height || null,
            generation_size: image.generation_size || null,
            output_format: image.output_format || runMetadata.output_format || null,
            transparent_background: Boolean(image.transparent_background ?? runMetadata.transparent_background),
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
