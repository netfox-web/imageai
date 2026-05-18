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

const providerSafetyErrorMessage =
  '圖片被供應商安全系統拒絕處理，未產生結果，點數已退回。請換一張較清楚、無敏感人物/角色/商標疑慮的商品圖後再試。';
const providerOutputInvalidErrorMessage = '智慧去背未產生透明背景，請換一張主體更清楚、背景更單純的圖片後再試。';
const providerCapabilityUnsupportedErrorMessage =
  '目前尚未設定可用的圖生影片供應商，未產生影片，點數已退回。請到後台設定支援圖生影片的供應商後再試。';

const externalProviderFailedErrorMessage =
  '外部圖生影片供應商未回傳可用影片，未產生結果，點數已退回。請稍後再試或通知管理員檢查供應商設定。';

const providerSafetySignals = [
  'moderation',
  'provider_rejected',
  'policy',
  'safety',
  'safety system',
  'content policy',
  'your request was rejected',
  'request was rejected as a result of our safety system',
];

export function friendlyTaskError(meta = emptyTaskCostMeta(), fallback = '') {
  const haystack = [meta?.errorCode, meta?.errorMessage, fallback].filter(Boolean).join(' ').toLowerCase();
  if (haystack.includes('provider_output_invalid')) {
    return providerOutputInvalidErrorMessage;
  }
  if (haystack.includes('provider_capability_unsupported')) {
    return providerCapabilityUnsupportedErrorMessage;
  }
  if (haystack.includes('external_provider_failed')) {
    return externalProviderFailedErrorMessage;
  }
  if (providerSafetySignals.some((signal) => haystack.includes(signal))) {
    return providerSafetyErrorMessage;
  }
  return shortTaskError(meta, fallback);
}

export function imageLoadErrorMessage() {
  return '圖片可能尚未公開或 storage public URL 設定有誤';
}
