import { fallbackPrompts, renderPromptByKey, taskPromptVariables } from './PromptRenderer.js';
import { storageService } from './StorageService.js';

const maxPromptTextLength = 4000;

export function buildProductCopyPrompt(task) {
  const variables = taskPromptVariables(task);
  const prompt = renderPromptByKey('product_copywriting', variables, fallbackPrompts.product_copywriting);
  return redactSensitiveText([
    prompt.systemPrompt || 'You write concise ecommerce product copy.',
    prompt.userPrompt,
    'Return plain text with these sections: title, short description, key selling points, CTA, keywords, hashtags.',
    'Do not include API keys, credentials, storage paths, or private system configuration.',
  ]
    .filter(Boolean)
    .join('\n\n'))
    .slice(0, maxPromptTextLength);
}

export function buildFakeProductCopy(task) {
  const product = task.product_name || task.main_title || 'Demo Product';
  const subtitle = task.subtitle || 'Designed for practical ecommerce campaigns.';
  const notes = task.custom_prompt || 'Clean positioning for a product listing.';
  return [
    `Title: ${product}`,
    `Short description: ${subtitle}`,
    'Key selling points:',
    `- ${notes}`,
    '- Clear value for shoppers',
    '- Ready for product pages, ads, and social captions',
    'CTA: Shop now and make the everyday easier.',
    `Keywords: ${product}, ecommerce, product, gift`,
    `Hashtags: #${slugForHash(product)} #ecommerce #product`,
  ].join('\n');
}

export async function persistProductCopyOutput(task, text) {
  const content = normalizeCopyText(text);
  const buffer = Buffer.from(`${content}\n`, 'utf8');
  const storagePath = await storageService.putOutput(buffer, `task-${task.id}-copywriting-${Date.now()}.txt`);
  return {
    storage_path: storagePath,
    width: null,
    height: null,
    file_size: buffer.length,
    mime_type: 'text/plain',
    text_preview: content.slice(0, 500),
  };
}

export function normalizeTextResultMetadata(result, providerName, modelName) {
  return {
    provider: result.provider || providerName,
    model: result.model || modelName || providerName,
    image_count: 0,
    output_type: 'copywriting',
    usage: result.usage || null,
    cost_usd: result.provider === 'fake' || providerName === 'fake' ? 0 : null,
    latency_ms: Number(result.latency_ms || 0),
    raw_response_json: result.raw_response_json_safe || null,
    error_code: result.error_code || null,
    error_message: result.error_message || null,
  };
}

export function throwIfTextResultFailed(result, fallbackMessage = 'Product copywriting failed.') {
  if (result?.ok !== false) return;
  const error = new Error(result.error_message || fallbackMessage);
  error.code = result.error_code || 'copywriting_failed';
  error.retryable = Boolean(result.retryable);
  error.status = result.http_status || result.status || null;
  throw error;
}

function normalizeCopyText(text) {
  const content = redactSensitiveText(String(text || '').trim());
  return content || 'No copy generated.';
}

function redactSensitiveText(text) {
  return text
    .replace(/\b(sk-[A-Za-z0-9_-]{10,})\b/g, '[redacted-api-key]')
    .replace(/\b(api[_-]?key|secret|token|password)\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted]')
    .replace(/\/volume1\/[^\s"'<>]+/g, '[redacted-storage-path]')
    .replace(/[A-Za-z]:\\Users\\[^\s"'<>]+/g, '[redacted-local-path]')
    .replace(/\.env[_A-Za-z0-9.-]*/g, '[redacted-env-file]');
}

function slugForHash(value) {
  const slug = String(value || '')
    .replace(/[^\p{L}\p{N}]+/gu, '')
    .slice(0, 24);
  return slug || 'product';
}
