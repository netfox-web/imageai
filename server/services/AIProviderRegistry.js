import { config } from '../config/index.js';
import { FakeAIProvider } from './FakeAIProvider.js';
import { OpenAIProvider } from './OpenAIProvider.js';
import { ExternalAIProvider } from './ExternalAIProvider.js';
import { GeminiProvider } from './providers/GeminiProvider.js';
import { ClaudeProvider } from './providers/ClaudeProvider.js';
import { DevPilotGatewayProvider } from './providers/DevPilotGatewayProvider.js';

const baseCapabilities = ['summary', 'classification', 'rewrite', 'extraction', 'planning', 'chat', 'generate'];
const imageCapabilities = ['image_generation', 'image_editing', 'image_variation', 'prompt_rewrite'];

function hasValue(value) {
  return Boolean(String(value || '').trim());
}

function meta({
  name,
  label,
  enabled = true,
  configured = false,
  models = [],
  capabilities = [],
  supportsImageGeneration = false,
  supportsImageEditing = false,
  supportsTextGeneration = true,
  keyConfigured = false,
  source = 'env',
  factory,
}) {
  return {
    name,
    label,
    enabled,
    configured,
    models,
    capabilities,
    supportsImageGeneration,
    supportsImageEditing,
    supportsTextGeneration,
    keyConfigured,
    source,
    factory,
  };
}

function definitions(currentConfig = config) {
  return [
    meta({
      name: 'fake',
      label: 'Fake Provider',
      configured: true,
      models: ['fake'],
      capabilities: [...baseCapabilities, ...imageCapabilities],
      supportsImageGeneration: true,
      supportsImageEditing: true,
      keyConfigured: true,
      source: 'built-in',
      factory: () => new FakeAIProvider(),
    }),
    meta({
      name: 'openai',
      label: 'OpenAI',
      configured: hasValue(currentConfig.openaiApiKey),
      keyConfigured: hasValue(currentConfig.openaiApiKey),
      models: [currentConfig.openaiTextModel, currentConfig.openaiImageModel].filter(Boolean),
      capabilities: [...baseCapabilities, ...imageCapabilities],
      supportsImageGeneration: true,
      supportsImageEditing: true,
      source: 'env',
      factory: () => new OpenAIProvider(),
    }),
    meta({
      name: 'gemini',
      label: 'Google Gemini',
      configured: hasValue(currentConfig.geminiApiKey),
      keyConfigured: hasValue(currentConfig.geminiApiKey),
      models: [currentConfig.geminiModel || 'gemini-1.5-flash'],
      capabilities: [...baseCapabilities, ...imageCapabilities],
      supportsImageGeneration: true,
      supportsImageEditing: true,
      source: 'env',
      factory: (options = {}) => new GeminiProvider(options),
    }),
    meta({
      name: 'claude',
      label: 'Anthropic Claude',
      configured: hasValue(currentConfig.claudeApiKey),
      keyConfigured: hasValue(currentConfig.claudeApiKey),
      models: [currentConfig.claudeModel].filter(Boolean),
      capabilities: [...baseCapabilities, 'prompt_rewrite'],
      supportsImageGeneration: false,
      supportsImageEditing: false,
      source: 'env',
      factory: (options = {}) => new ClaudeProvider(options),
    }),
    meta({
      name: 'external',
      label: 'External AI',
      configured: hasValue(currentConfig.externalAiBaseUrl),
      keyConfigured: hasValue(currentConfig.externalAiApiKey),
      models: ['external'],
      capabilities: [...baseCapabilities, ...imageCapabilities],
      supportsImageGeneration: true,
      supportsImageEditing: true,
      source: 'env',
      factory: () => new ExternalAIProvider(),
    }),
    meta({
      name: 'devpilot-gateway',
      label: 'DevPilot Gateway',
      configured: hasValue(currentConfig.devpilotGatewayBaseUrl),
      keyConfigured: hasValue(currentConfig.devpilotGatewayApiKey),
      models: [currentConfig.devpilotGatewayModel || 'devpilot-gateway'],
      capabilities: [...baseCapabilities, ...imageCapabilities],
      supportsImageGeneration: true,
      supportsImageEditing: true,
      source: 'env-or-admin-gateway',
      factory: () => new DevPilotGatewayProvider(),
    }),
  ];
}

export function listProviders(currentConfig = config) {
  return definitions(currentConfig).map(stripFactory);
}

export function getProviderDefinition(name, currentConfig = config) {
  const normalized = String(name || 'fake').toLowerCase();
  return definitions(currentConfig).find((provider) => provider.name === normalized) || definitions(currentConfig)[0];
}

export function getProvider(name, currentConfig = config, options = {}) {
  return getProviderDefinition(name, currentConfig).factory(options);
}

export function getAvailableCapabilities(providerName, currentConfig = config) {
  return getProviderDefinition(providerName, currentConfig).capabilities;
}

export function validateProviderConfig(providerName, currentConfig = config) {
  const provider = getProviderDefinition(providerName, currentConfig);
  const checks = [];
  if (!provider.enabled) {
    checks.push({ level: 'FAIL', key: provider.name, message: `${provider.label} is disabled.` });
  }
  if (provider.name !== 'fake' && !provider.configured) {
    checks.push({
      level: 'FAIL',
      key: provider.name,
      message: `${provider.label} is not configured.`,
      suggestion: providerConfigSuggestion(provider.name),
    });
  }
  if (!provider.models.length) {
    checks.push({ level: 'WARN', key: `${provider.name}.models`, message: `${provider.label} has no explicit model configured.` });
  }
  if (!checks.length) {
    checks.push({ level: 'PASS', key: provider.name, message: `${provider.label} is configured for non-live use.` });
  }
  return { ok: !checks.some((check) => check.level === 'FAIL'), provider: stripFactory(provider), checks };
}

export async function pingProvider(providerName, options = {}, currentConfig = config) {
  const validation = validateProviderConfig(providerName, currentConfig);
  if (!validation.ok) {
    return { ok: false, live: false, provider: validation.provider, checks: validation.checks };
  }
  if (!options.live) {
    return {
      ok: true,
      live: false,
      provider: validation.provider,
      checks: validation.checks,
      message: 'Configuration ping only. Set live=true in a dedicated diagnostic to call the provider API.',
    };
  }
  const previous = applyTemporaryProviderConfig(providerName, currentConfig);
  try {
    const provider = getProvider(providerName, currentConfig, { fetchImpl: options.fetchImpl });
    if (typeof provider.ping !== 'function') {
      return {
        ok: false,
        live: true,
        provider: validation.provider,
        checks: [{ level: 'WARN', key: 'live', message: `${validation.provider.label} does not expose a ping method.` }],
      };
    }
    const result = await provider.ping({ model: options.model });
    return { ...result, live: true, provider_metadata: validation.provider };
  } finally {
    Object.assign(config, previous);
  }
}

function stripFactory(provider) {
  const { factory, ...safe } = provider;
  return safe;
}

function providerConfigSuggestion(providerName) {
  if (providerName === 'openai') return 'Set OPENAI_API_KEY.';
  if (providerName === 'gemini') return 'Set GEMINI_API_KEY or GOOGLE_API_KEY.';
  if (providerName === 'claude') return 'Set ANTHROPIC_API_KEY.';
  if (providerName === 'external') return 'Set EXTERNAL_AI_BASE_URL and optional EXTERNAL_AI_API_KEY.';
  if (providerName === 'devpilot-gateway') return 'Set DEVPILOT_GATEWAY_BASE_URL and optional DEVPILOT_GATEWAY_API_KEY.';
  return 'Check provider configuration.';
}

function applyTemporaryProviderConfig(providerName, currentConfig) {
  const snapshot = {};
  const keys = [
    'geminiApiKey',
    'geminiModel',
    'geminiBaseUrl',
    'claudeApiKey',
    'claudeModel',
    'claudeBaseUrl',
    'claudeApiVersion',
  ];
  keys.forEach((key) => {
    snapshot[key] = config[key];
    if (Object.prototype.hasOwnProperty.call(currentConfig, key)) {
      config[key] = currentConfig[key];
    }
  });
  return snapshot;
}

export const aiProviderRegistry = {
  getAvailableCapabilities,
  getProvider,
  getProviderDefinition,
  listProviders,
  pingProvider,
  validateProviderConfig,
};
