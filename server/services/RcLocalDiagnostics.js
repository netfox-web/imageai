import fs from 'node:fs/promises';
import path from 'node:path';
import { config as appConfig } from '../config/index.js';
import { runEnvDiagnostics } from './EnvDiagnostics.js';
import { runStorageCheck } from './StorageDiagnostics.js';
import { listProviders } from './AIProviderRegistry.js';
import { redactAuditValue } from './AuditService.js';

export async function runRcLocalDiagnostics({
  env = process.env,
  config = appConfig,
  fetchImpl = fetch,
  reportPath = env.RC_LOCAL_REPORT_PATH || './tmp/rc-local-report.json',
  storageCheck = runStorageCheck,
} = {}) {
  const startedAt = new Date();
  const envResult = runEnvDiagnostics(env, config);
  const storageResult = await storageCheck({ config, checkPublicUrl: false, reportPath: '' });
  const health = await checkHealth({ config, fetchImpl });
  const providers = listProviders().map((provider) => ({
    name: provider.name,
    label: provider.label,
    configured: Boolean(provider.configured),
    enabled: Boolean(provider.enabled),
    capabilities: provider.capabilities || [],
    models: provider.models || [],
    keyConfigured: Boolean(provider.keyConfigured),
    source: provider.source || '',
  }));
  const result = redactAuditValue({
    ok: envResult.ok && storageResult.ok,
    started_at: startedAt.toISOString(),
    finished_at: new Date().toISOString(),
    duration_ms: Date.now() - startedAt.getTime(),
    env: envResult.env,
    env_ok: envResult.ok,
    storage_ok: storageResult.ok,
    health,
    providers,
    checks: {
      env_failures: envResult.checks.filter((check) => check.level === 'FAIL').length,
      env_warnings: envResult.checks.filter((check) => check.level === 'WARN').length,
      storage_errors: storageResult.errors || [],
    },
  });
  if (reportPath) {
    await fs.mkdir(path.dirname(reportPath), { recursive: true });
    await fs.writeFile(reportPath, JSON.stringify(result, null, 2));
  }
  return result;
}

async function checkHealth({ config, fetchImpl }) {
  const baseUrl = String(config.appUrl || `http://localhost:${config.port || 3000}`).replace(/\/+$/, '');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2500);
  try {
    const response = await fetchImpl(`${baseUrl}/health/deep`, { signal: controller.signal });
    const body = await response.json().catch(() => ({}));
    return {
      checked: true,
      ok: response.ok && body.ok !== false,
      status: response.status,
      url: `${baseUrl}/health/deep`,
      body: redactAuditValue(body),
    };
  } catch (error) {
    return {
      checked: false,
      ok: true,
      skipped: true,
      url: `${baseUrl}/health/deep`,
      reason: `Server not reachable or health check skipped: ${error.name || error.message}`,
    };
  } finally {
    clearTimeout(timer);
  }
}
