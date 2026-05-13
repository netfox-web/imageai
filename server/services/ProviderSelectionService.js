import { config } from '../config/index.js';
import { getProviderDefinition, validateProviderConfig } from './AIProviderRegistry.js';

function toBool(value) {
  return value === true || value === 'true' || value === '1' || value === 1;
}

export function resolveProviderSelection({
  requestedProvider = '',
  requestedModel = '',
  capability = 'generate',
  strict = false,
} = {}) {
  const desired = String(requestedProvider || config.aiProvider || 'fake').toLowerCase();
  const strictMode = toBool(strict);
  const validation = validateProviderConfig(desired);
  const requestedDefinition = getProviderDefinition(desired);

  if (requestedProvider && validation.ok) {
    return buildSelection({
      requestedProvider: desired,
      resolvedProvider: desired,
      requestedModel,
      resolvedModel: requestedModel || requestedDefinition.models?.[0] || desired,
      capability,
      source: requestedDefinition.source,
      reason: 'requested_provider_configured',
      fallbackReason: '',
    });
  }

  if (requestedProvider && !validation.ok && strictMode) {
    const error = new Error(`${requestedDefinition.label || desired} is not configured.`);
    error.status = 422;
    error.code = 'provider_not_configured';
    error.selection = buildSelection({
      requestedProvider: desired,
      resolvedProvider: '',
      requestedModel,
      resolvedModel: '',
      capability,
      source: requestedDefinition.source,
      reason: 'requested_provider_unavailable_strict',
      fallbackReason: validation.checks?.[0]?.suggestion || validation.checks?.[0]?.message || 'Provider unavailable.',
    });
    throw error;
  }

  if (requestedProvider && !validation.ok) {
    return buildSelection({
      requestedProvider: desired,
      resolvedProvider: 'fake',
      requestedModel,
      resolvedModel: 'fake',
      capability,
      source: 'built-in',
      reason: 'requested_provider_unavailable_fallback_fake',
      fallbackReason: validation.checks?.[0]?.message || 'Provider unavailable.',
    });
  }

  if (!requestedProvider && validation.ok) {
    return buildSelection({
      requestedProvider: desired,
      resolvedProvider: desired,
      requestedModel,
      resolvedModel: requestedModel || requestedDefinition.models?.[0] || desired,
      capability,
      source: requestedDefinition.source,
      reason: 'config_provider_configured',
      fallbackReason: '',
    });
  }

  if (!requestedProvider && strictMode) {
    return buildSelection({
      requestedProvider: desired,
      resolvedProvider: desired,
      requestedModel,
      resolvedModel: requestedModel || requestedDefinition.models?.[0] || desired,
      capability,
      source: requestedDefinition.source,
      reason: 'config_provider_unavailable_strict_job_validation',
      fallbackReason: validation.checks?.[0]?.suggestion || validation.checks?.[0]?.message || 'Configured provider unavailable.',
    });
  }

  return buildSelection({
    requestedProvider: desired,
    resolvedProvider: 'fake',
    requestedModel,
    resolvedModel: 'fake',
    capability,
    source: 'built-in',
    reason: 'config_provider_unavailable_fallback_fake',
    fallbackReason: validation.checks?.[0]?.suggestion || validation.checks?.[0]?.message || 'Configured provider unavailable.',
  });
}

function buildSelection({
  requestedProvider,
  resolvedProvider,
  requestedModel,
  resolvedModel,
  capability,
  source,
  reason,
  fallbackReason,
}) {
  return {
    requested_provider: requestedProvider || '',
    resolved_provider: resolvedProvider || '',
    requested_model: requestedModel || '',
    resolved_model: resolvedModel || '',
    requested_capability: capability || 'generate',
    provider_config_source: source || '',
    provider_selection_reason: reason || '',
    fallback_reason: fallbackReason || '',
  };
}

export const providerSelectionService = {
  resolveProvider: resolveProviderSelection,
};
