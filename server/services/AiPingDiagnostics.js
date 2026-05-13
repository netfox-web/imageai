import fs from 'node:fs/promises';
import path from 'node:path';
import { config as appConfig } from '../config/index.js';
import { getProvider, listProviders } from './AIProviderRegistry.js';

const supportedPingProviders = new Set(['fake', 'openai', 'gemini', 'claude']);

export function defaultAiPingReportPath(config = appConfig) {
  return path.join(config.rootDir, 'tmp', 'ai-ping-last.json');
}

export async function runAiPing({
  env = process.env,
  config = appConfig,
  fetchImpl = fetch,
  reportPath = env.AI_PING_REPORT_PATH || config.aiPingReportPath || '',
} = {}) {
  const startedAt = new Date();
  const providerName = String(env.AI_PING_PROVIDER || config.aiPingProvider || config.aiProvider || 'fake').toLowerCase();
  const prompt = env.AI_PING_PROMPT || config.aiPingPrompt || 'Return exactly one short sentence: AI_PING_OK';
  const model = env.AI_PING_MODEL || config.aiPingModel || '';
  const timeoutMs = Number(env.AI_PING_TIMEOUT_MS || config.aiPingTimeoutMs || 30000);
  let result;

  if (!supportedPingProviders.has(providerName)) {
    result = {
      ok: false,
      provider: providerName,
      model: model || '',
      output: '',
      latency_ms: 0,
      usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
      retryable: false,
      error_code: 'unsupported_provider',
      error_message: 'ai:ping currently supports fake, openai, gemini, and claude.',
      http_status: null,
    };
  } else {
    const restore = applyAiPingEnv(env, config);
    try {
      const provider = getProvider(providerName, config, { fetchImpl: withTimeout(fetchImpl, timeoutMs) });
      if (typeof provider.generateText !== 'function') {
        throw new Error(`${providerName} does not support generateText ping.`);
      }
      result = await provider.generateText({ prompt, model });
    } catch (error) {
      result = normalizeThrownError({ error, providerName, model, startedAt });
    } finally {
      restore();
    }
  }

  const report = normalizeAiPingReport({
    result,
    providerName,
    model,
    prompt,
    startedAt,
    timeoutMs,
    env,
  });
  const defaultPath = defaultAiPingReportPath(config);
  await writeAiPingReport(defaultPath, report);
  if (reportPath && path.resolve(reportPath) !== path.resolve(defaultPath)) {
    await writeAiPingReport(reportPath, report);
  }
  return report;
}

export async function readAiPingLastReport({ config = appConfig, reportPath = defaultAiPingReportPath(config) } = {}) {
  try {
    const raw = await fs.readFile(reportPath, 'utf8');
    return redactKnownSecrets(JSON.parse(raw), process.env);
  } catch {
    return null;
  }
}

export function normalizeAiPingReport({ result, providerName, model, prompt, startedAt, timeoutMs, env }) {
  const diagnosis = diagnoseAiPing(result);
  const safe = {
    ok: Boolean(result?.ok),
    provider: result?.provider || providerName,
    model: result?.model || model || '',
    output: result?.output || '',
    usage: result?.usage || { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
    latency_ms: Number(result?.latency_ms || 0),
    retryable: Boolean(result?.retryable),
    error_code: result?.error_code || null,
    error_message: result?.error_message || null,
    http_status: result?.http_status || null,
    diagnosis,
    prompt_preview: String(prompt || '').slice(0, 180),
    timeout_ms: timeoutMs,
    started_at: startedAt.toISOString(),
    finished_at: new Date().toISOString(),
    providers_summary: listProviders().map((provider) => ({
      name: provider.name,
      configured: Boolean(provider.configured),
      models: provider.models,
      capabilities: provider.capabilities,
    })),
    raw_response_json_safe: result?.raw_response_json_safe || null,
  };
  return redactKnownSecrets(redactAiPingValue(safe), env);
}

export function diagnoseAiPing(result = {}) {
  if (result.ok) return { code: 'ok', message: 'Provider ping succeeded.' };
  const status = Number(result.http_status || result.error_code || 0);
  const code = String(result.error_code || '').toLowerCase();
  const message = String(result.error_message || '').toLowerCase();
  if (status === 401 || status === 403 || /permission|credential|unauth|api[_-]?key|invalid[_-]?x-api-key|forbidden/.test(`${code} ${message}`)) {
    return { code: 'credential_rejected', message: 'Provider rejected the credential. Check the API key, account, project, and model access.' };
  }
  if (status === 429 || /quota|rate|resource_exhausted/.test(`${code} ${message}`)) {
    return { code: 'quota_or_rate_limit', message: 'Provider returned quota or rate-limit pressure. Retry later or check billing/quota.' };
  }
  if (status >= 500) {
    return { code: 'provider_server_error', message: 'Provider returned a server-side error. Retry later if this is transient.' };
  }
  if (result.retryable || /abort|timeout|network|typeerror/.test(`${code} ${message}`)) {
    return { code: 'timeout_or_network_retryable', message: 'Network or timeout failure. This is retryable.' };
  }
  if (code === 'missing_api_key') {
    return { code: 'missing_api_key', message: 'Provider API key is missing from the runtime environment.' };
  }
  return { code: 'provider_error', message: 'Provider ping failed. Review the safe error fields.' };
}

async function writeAiPingReport(reportPath, report) {
  if (!reportPath) return;
  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
}

function normalizeThrownError({ error, providerName, model, startedAt }) {
  return {
    ok: false,
    provider: providerName,
    model: model || '',
    output: '',
    usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
    latency_ms: Date.now() - startedAt.getTime(),
    raw_response_json_safe: null,
    error_code: String(error.code || error.status || error.name || 'ai_ping_failed'),
    error_message: error.message || 'AI ping failed.',
    retryable: error.name === 'AbortError' || error.name === 'TimeoutError' || error instanceof TypeError || Number(error.status || 0) === 429 || Number(error.status || 0) >= 500,
    http_status: error.status || null,
  };
}

function applyAiPingEnv(env, config) {
  const snapshot = {
    aiProvider: config.aiProvider,
    openaiApiKey: config.openaiApiKey,
    openaiBaseUrl: config.openaiBaseUrl,
    openaiTextModel: config.openaiTextModel,
    geminiApiKey: config.geminiApiKey,
    geminiBaseUrl: config.geminiBaseUrl,
    geminiModel: config.geminiModel,
    claudeApiKey: config.claudeApiKey,
    claudeBaseUrl: config.claudeBaseUrl,
    claudeModel: config.claudeModel,
    claudeApiVersion: config.claudeApiVersion,
  };
  config.aiProvider = env.AI_PING_PROVIDER || config.aiProvider;
  config.openaiApiKey = env.OPENAI_API_KEY ?? config.openaiApiKey;
  config.openaiBaseUrl = env.OPENAI_BASE_URL || config.openaiBaseUrl;
  config.openaiTextModel = env.AI_PING_MODEL || env.OPENAI_TEXT_MODEL || config.openaiTextModel;
  config.geminiApiKey = env.GEMINI_API_KEY || env.GOOGLE_GENERATIVE_AI_API_KEY || env.GOOGLE_API_KEY || config.geminiApiKey;
  config.geminiBaseUrl = env.GEMINI_BASE_URL || config.geminiBaseUrl;
  config.geminiModel = env.AI_PING_MODEL || env.GEMINI_MODEL || config.geminiModel;
  config.claudeApiKey = env.ANTHROPIC_API_KEY || env.CLAUDE_API_KEY || config.claudeApiKey;
  config.claudeBaseUrl = env.CLAUDE_BASE_URL || config.claudeBaseUrl;
  config.claudeModel = env.AI_PING_MODEL || env.CLAUDE_MODEL || config.claudeModel;
  config.claudeApiVersion = env.CLAUDE_API_VERSION || config.claudeApiVersion;
  return () => Object.assign(config, snapshot);
}

function withTimeout(fetchImpl, timeoutMs) {
  return async (url, options = {}) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetchImpl(url, { ...options, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  };
}

function redactKnownSecrets(value, env = process.env) {
  const secrets = [
    env.OPENAI_API_KEY,
    env.GEMINI_API_KEY,
    env.GOOGLE_GENERATIVE_AI_API_KEY,
    env.GOOGLE_API_KEY,
    env.ANTHROPIC_API_KEY,
    env.CLAUDE_API_KEY,
  ].filter((item) => item && String(item).length >= 6);
  const redactString = (text) => {
    let result = String(text);
    secrets.forEach((secret) => {
      result = result.replaceAll(String(secret), '[redacted]');
    });
    return result;
  };
  if (typeof value === 'string') return redactString(value);
  if (Array.isArray(value)) return value.map((item) => redactKnownSecrets(item, env));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactKnownSecrets(item, env)]));
  }
  return value;
}

function redactAiPingValue(value) {
  if (typeof value === 'string') {
    if (value.length > 240 && (/^[A-Za-z0-9+/=]+$/.test(value) || value.startsWith('data:image/'))) return '[redacted_base64]';
    return value.length > 1200 ? `${value.slice(0, 1200)}...[truncated]` : value;
  }
  if (Array.isArray(value)) return value.map(redactAiPingValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        /api[_-]?key|secret|password|authorization|access[_-]?token|refresh[_-]?token|bearer|hash/i.test(key)
          ? '[redacted]'
          : redactAiPingValue(item),
      ]),
    );
  }
  return value;
}
