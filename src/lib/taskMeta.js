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

  const firstOutput = Array.isArray(raw.outputs) ? raw.outputs[0] || {} : {};
  const providerTrace = raw.provider_trace || {};

  return {
    provider: log.provider || raw.provider || '',
    model: log.model || raw.model || '',
    imageCount: Number(log.image_count ?? raw.image_count ?? 0),
    cost: log.cost_usd ?? raw.cost ?? raw.estimated_cost ?? null,
    fallbackUsed: Boolean(raw.fallback_used || log.provider === 'fake'),
    fallbackReason: raw.fallback_reason || raw.error || '',
    fallbackFrom: raw.fallback_from || providerTrace.fallback_from || '',
    latencyMs: raw.latency_ms ?? null,
    errorCode: raw.error_code || '',
    errorMessage: raw.error_message || raw.error || '',
    imageMode: raw.image_mode || firstOutput.image_mode || '',
    usedReferenceImage: Boolean(raw.used_reference_image || firstOutput.used_reference_image),
    storageDisk: raw.storage_disk || '',
    requestedProvider: raw.requested_provider || providerTrace.requested_provider || '',
    resolvedProvider: raw.resolved_provider || providerTrace.resolved_provider || raw.provider || log.provider || '',
    effectiveProvider: raw.effective_provider || providerTrace.effective_provider || raw.provider || log.provider || '',
    requestedModel: raw.requested_model || providerTrace.requested_model || '',
    resolvedModel: raw.resolved_model || providerTrace.resolved_model || raw.model || log.model || '',
    effectiveModel: raw.effective_model || providerTrace.effective_model || raw.model || log.model || '',
    requestedCapability: raw.requested_capability || providerTrace.requested_capability || '',
    providerSelectionReason: raw.provider_selection_reason || providerTrace.provider_selection_reason || '',
    providerTrace,
    qualityReviewRequired: Boolean(raw.quality_review_required),
    outputType: raw.output_type || '',
    outputFormat: raw.output_format || firstOutput.output_format || '',
    transparentBackground: Boolean(raw.transparent_background || firstOutput.transparent_background),
    editOptions: raw.edit_options || null,
    outputs: Array.isArray(raw.outputs) ? raw.outputs : [],
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
    fallbackFrom: '',
    latencyMs: null,
    errorCode: '',
    errorMessage: '',
    imageMode: '',
    usedReferenceImage: false,
    storageDisk: '',
    requestedProvider: '',
    resolvedProvider: '',
    effectiveProvider: '',
    requestedModel: '',
    resolvedModel: '',
    effectiveModel: '',
    requestedCapability: '',
    providerSelectionReason: '',
    providerTrace: {},
    qualityReviewRequired: false,
    outputType: '',
    outputFormat: '',
    transparentBackground: false,
    editOptions: null,
    outputs: [],
  };
}

export function shortTaskError(meta = emptyTaskCostMeta(), fallback = '') {
  const message = meta.errorMessage || fallback || '';
  return message.length > 180 ? `${message.slice(0, 180)}...` : message;
}

export function imageLoadErrorMessage() {
  return '圖片可能尚未公開或 storage public URL 設定有誤';
}
