import { now } from '../db/database.js';
import { AiCostLog, GenerationTask } from '../models/index.js';
import { config } from '../config/index.js';
import { creditService } from './CreditService.js';

export function classifyTaskError(error = {}) {
  const code = error.code || error.name || 'provider_error';
  const message = String(error.message || '');
  const lower = message.toLowerCase();
  const retryable =
    error.retryable === true ||
    code === 'storage_error' ||
    code === 'provider_error' ||
    lower.includes('storage') ||
    lower.includes('r2') ||
    lower.includes('s3') ||
    lower.includes('timeout');
  const nonRetryable =
    error.retryable === false ||
    code === 'validation_error' ||
    code === 'configuration_error' ||
    lower.includes('openai_api_key') ||
    lower.includes('invalid api key') ||
    lower.includes('forced failure');
  return {
    code,
    message,
    retryable: retryable && !nonRetryable,
  };
}

export function recordTaskFailure(task, error, context = {}) {
  const classification = classifyTaskError(error);
  const retryCount = Number(task.retry_count || 0);
  const maxRetries = Number(task.max_retries ?? 2);
  const nextRetryCount = retryCount + 1;
  const canRetry = classification.retryable && retryCount < maxRetries;
  const inputCount = context.inputCount ?? GenerationTask.images(task.id, 'input').length;
  const latencyMs = context.latencyMs ?? null;

  AiCostLog.create({
    task_id: task.id,
    provider: context.providerName || 'unknown',
    model: context.modelName || context.providerName || 'unknown',
    input_tokens: null,
    output_tokens: null,
    image_count: inputCount,
    cost_usd: 0,
    raw_response_json: JSON.stringify({
      provider: context.providerName || 'unknown',
      model: context.modelName || context.providerName || 'unknown',
      image_count: inputCount,
      usage: null,
      estimated_cost: 0,
      cost: 0,
      storage_disk: config.filesystemDisk,
      image_mode: null,
      used_reference_image: false,
      fallback_used: false,
      fallback_reason: null,
      latency_ms: latencyMs,
      error_code: classification.code,
      error_message: classification.message,
      retryable: classification.retryable,
      retry_count: canRetry ? nextRetryCount : retryCount,
      final_failed: !canRetry,
    }),
  });

  if (canRetry) {
    return GenerationTask.update(task.id, {
      status: 'pending',
      retry_count: nextRetryCount,
      last_error_code: classification.code,
      last_error_message: classification.message,
      error_message: classification.message,
      finished_at: now(),
    });
  }

  const updated = GenerationTask.update(task.id, {
    status: 'failed',
    retry_count: retryCount,
    last_error_code: classification.code,
    last_error_message: classification.message,
    error_message: classification.message,
    failed_at: now(),
    finished_at: now(),
  });
  creditService.refundFailedTask(task.id, classification.message);
  return updated;
}
