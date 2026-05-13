export function parseTaskCostMeta(log = null) {
  if (!log) {
    return emptyTaskCostMeta();
  }

  let raw = {};
  try {
    raw = typeof log.raw_response_json === 'string' ? JSON.parse(log.raw_response_json) : log.raw_response_json || {};
  } catch {
    raw = {};
  }

  return {
    provider: log.provider || raw.provider || '',
    model: log.model || raw.model || '',
    imageCount: Number(log.image_count ?? raw.image_count ?? 0),
    cost: log.cost_usd ?? raw.cost ?? raw.estimated_cost ?? null,
    fallbackUsed: Boolean(raw.fallback_used || log.provider === 'fake'),
    fallbackReason: raw.fallback_reason || raw.error || '',
    latencyMs: raw.latency_ms ?? null,
    errorCode: raw.error_code || '',
    errorMessage: raw.error_message || raw.error || '',
    imageMode: raw.image_mode || '',
    usedReferenceImage: Boolean(raw.used_reference_image),
    storageDisk: raw.storage_disk || '',
    requestedProvider: raw.requested_provider || '',
    resolvedProvider: raw.resolved_provider || raw.provider || log.provider || '',
    requestedModel: raw.requested_model || '',
    resolvedModel: raw.resolved_model || raw.model || log.model || '',
    requestedCapability: raw.requested_capability || '',
    providerSelectionReason: raw.provider_selection_reason || '',
    qualityReviewRequired: Boolean(raw.quality_review_required),
  };
}

export function emptyTaskCostMeta() {
  return {
    provider: '',
    model: '',
    imageCount: 0,
    cost: null,
    fallbackUsed: false,
    fallbackReason: '',
    latencyMs: null,
    errorCode: '',
    errorMessage: '',
    imageMode: '',
    usedReferenceImage: false,
    storageDisk: '',
    requestedProvider: '',
    resolvedProvider: '',
    requestedModel: '',
    resolvedModel: '',
    requestedCapability: '',
    providerSelectionReason: '',
    qualityReviewRequired: false,
  };
}

export function shortTaskError(meta = emptyTaskCostMeta(), fallback = '') {
  const message = meta.errorMessage || fallback || '';
  return message.length > 180 ? `${message.slice(0, 180)}...` : message;
}

export function imageLoadErrorMessage() {
  return '圖片可能尚未公開或 storage public URL 設定有誤';
}
