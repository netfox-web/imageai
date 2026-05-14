import fs from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import { config, defaultAdminCredentialsAllowed } from '../config/index.js';
import { get } from '../db/database.js';
import { User } from '../models/index.js';
import { listProviders } from './AIProviderRegistry.js';
import { readAiPingLastReport } from './AiPingDiagnostics.js';
import { countActiveDevPilotExternalKeys } from './DevPilotExternalKeyService.js';
import { runStorageCheck } from './StorageDiagnostics.js';
import { storageService } from './StorageService.js';

const secretKey = /(api[_-]?key|secret|token|password|authorization|hash|credential)/i;
const sqliteLike = new Set(['sqlite', 'sqljs', 'sql.js']);

export async function runTrialCheck(options = {}) {
  const reportPath = options.reportPath || process.env.TRIAL_CHECK_REPORT_PATH || './tmp/trial-check.json';
  const fetchImpl = options.fetchImpl || fetch;
  const checks = [];
  const startedAt = new Date().toISOString();
  const publicRuntime = isPublicRuntime();

  const add = (name, status, details = {}) => checks.push({ name, status, ...redact(details) });

  let dbOk = false;
  try {
    dbOk = Boolean(get('SELECT 1 AS ok')?.ok);
    add('health', dbOk ? 'PASS' : 'FAIL', { db: dbOk, version: config.appVersion });
  } catch (error) {
    add('health', 'FAIL', { message: error.message });
  }

  add('trial_mode', config.trialMode ? 'PASS' : 'WARN', {
    enabled: config.trialMode,
    message: config.trialMode
      ? config.trialModeMessage
      : 'TRIAL_MODE is disabled; enable it while inviting trial users.',
  });

  let defaultAdminPasswordActive = false;
  let adminPasswordProductionNoGo = false;
  let adminPasswordNoGoReason = '';
  try {
    const adminPasswordCheck = await buildAdminPasswordCheck({ publicRuntime });
    defaultAdminPasswordActive = adminPasswordCheck.default_admin_password_active;
    adminPasswordProductionNoGo = adminPasswordCheck.production_release_status === 'No-Go';
    adminPasswordNoGoReason = adminPasswordCheck.reason || '';
    add(adminPasswordCheck.name, adminPasswordCheck.status, adminPasswordCheck.details);
  } catch (error) {
    adminPasswordProductionNoGo = publicRuntime;
    adminPasswordNoGoReason = 'admin password check failed';
    add('admin_password_check', publicRuntime ? 'FAIL' : 'WARN', { message: error.message });
  }

  if (config.domainCheckBaseUrlExplicit) {
    const healthUrl = joinUrl(config.domainCheckBaseUrl, '/health');
    try {
      const response = await fetchImpl(healthUrl, { method: 'GET' });
      add('public_domain_health', response.ok ? 'PASS' : 'FAIL', {
        url: healthUrl,
        status: response.status,
        message: response.ok ? 'Public domain health is reachable.' : 'Public domain health failed.',
      });
    } catch (error) {
      add('public_domain_health', 'FAIL', { url: healthUrl, message: error.message });
    }
  } else {
    add('public_domain_health', 'SKIP', {
      message: 'Set DOMAIN_CHECK_BASE_URL=https://imageai.tw when public domain validation is in scope.',
    });
  }

  const providers = listProviders();
  const lastPing = await readAiPingLastReport();
  add('provider_registry_summary', 'PASS', {
    providers: providers.map((provider) => ({
      name: provider.name,
      configured: provider.configured,
      capabilities: provider.capabilities,
    })),
    last_ping: lastPing
      ? {
          provider: lastPing.provider,
          model: lastPing.model,
          ok: lastPing.ok,
          skipped: lastPing.skipped,
          diagnosis: lastPing.diagnosis?.code,
          finished_at: lastPing.finished_at,
        }
      : null,
  });

  let storage = null;
  try {
    storage = await runStorageCheck({
      config,
      storage: storageService,
      checkPublicUrl: false,
    });
    add('storage_check', storage.ok ? 'PASS' : 'FAIL', {
      disk: storage.disk,
      write_ok: storage.write_ok,
      read_ok: storage.read_ok,
      delete_ok: storage.delete_ok,
      errors: storage.errors || [],
    });
  } catch (error) {
    add('storage_check', 'FAIL', { message: error.message });
  }

  const queueStatus = config.queueDriver === 'local'
    ? 'WARN'
    : config.queueDriver === 'worker' && sqliteLike.has(String(config.databaseClient).toLowerCase())
      ? 'FAIL'
      : 'PASS';
  add('queue_mode_check', queueStatus, {
    queue_driver: config.queueDriver,
    database_client: config.databaseClient,
    message: config.queueDriver === 'local' ? 'QUEUE_DRIVER=local is acceptable for a public trial but not scalable production queueing.' : '',
  });

  const adminSystemSafe = {
    app_url: config.appUrl,
    public_url: config.publicUrl,
    filesystem_disk: config.filesystemDisk,
    queue_driver: config.queueDriver,
    database_client: config.databaseClient,
    fake_provider_enabled: config.aiProvider === 'fake',
    registration_enabled: config.registrationEnabled,
    trial_mode_enabled: config.trialMode,
    invite_code_enabled: config.inviteCodeEnabled,
    invite_code_configured: Boolean(config.trialInviteCode),
    external_api_rate_limit_enabled: config.externalApiRateLimitEnabled,
    rate_limit_enabled: config.rateLimitEnabled,
    upload_limit_mb: config.maxUploadMb,
    allowed_image_types: config.allowedImageTypes,
    devpilot_key_count: countActiveDevPilotExternalKeys(),
    recent_failed_tasks_count: Number(get("SELECT COUNT(*) AS count FROM generation_tasks WHERE status = 'failed' AND deleted_at IS NULL")?.count || 0),
  };
  add('admin_system_safe_check', 'PASS', adminSystemSafe);

  add('public_smoke_instructions', 'INFO', {
    command: 'SMOKE_BASE_URL=https://imageai.tw SMOKE_EXPECT_PROVIDER=fake SMOKE_EXPECT_STORAGE_DISK=local npm run smoke:staging',
  });

  const productionBlockers = buildProductionBlockers({ adminPasswordProductionNoGo, adminPasswordNoGoReason });
  const report = redact({
    ok: checks.every((check) => check.status !== 'FAIL'),
    public_runtime: publicRuntime,
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    checks,
    summary: {
      health_ok: dbOk,
      trial_mode_enabled: config.trialMode,
      invite_code_enabled: config.inviteCodeEnabled,
      default_admin_password_active: defaultAdminPasswordActive,
      go_no_go: {
        public_trial: defaultAdminPasswordActive ? 'Conditional Go' : 'Go',
        production_release: productionBlockers.length ? 'No-Go' : 'Go',
        reason: productionBlockers[0] || '',
        blockers: productionBlockers,
      },
      provider_count: providers.length,
      storage_ok: Boolean(storage?.ok),
      queue_driver: config.queueDriver,
      database_client: config.databaseClient,
      devpilot_key_count: adminSystemSafe.devpilot_key_count,
      recent_failed_tasks_count: adminSystemSafe.recent_failed_tasks_count,
      last_provider_ping: lastPing ? {
        provider: lastPing.provider,
        ok: lastPing.ok,
        skipped: lastPing.skipped,
        diagnosis: lastPing.diagnosis?.code,
      } : null,
      secrets_redacted: true,
    },
  });

  const absolutePath = path.resolve(config.rootDir, reportPath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, `${JSON.stringify(report, null, 2)}\n`);
  return { ...report, report_path: reportPath };
}

export function formatTrialCheck(report) {
  const lines = [
    `trial:check ${report.ok ? 'PASS' : 'FAIL'}`,
    `report: ${report.report_path || './tmp/trial-check.json'}`,
  ];
  if (report.summary?.go_no_go) {
    lines.push(`Public trial: ${report.summary.go_no_go.public_trial}`);
    lines.push(`Production release: ${report.summary.go_no_go.production_release}`);
    if (report.summary.go_no_go.reason) lines.push(`reason: ${report.summary.go_no_go.reason}`);
  }
  for (const check of report.checks || []) {
    lines.push(`${check.status.padEnd(4)} ${check.name}`);
    if (check.message) lines.push(`     ${check.message}`);
  }
  return lines.join('\n');
}

function redact(value) {
  if (typeof value === 'string') {
    return value
      .replace(/sk-[A-Za-z0-9_-]{8,}/g, '[redacted_api_key]')
      .replace(/AIza[0-9A-Za-z_-]{20,}/g, '[redacted_api_key]')
      .replace(/[A-Za-z0-9+/=]{240,}/g, '[redacted_base64]');
  }
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, secretKey.test(key) ? '[redacted]' : redact(item)]),
    );
  }
  return value;
}

async function buildAdminPasswordCheck({ publicRuntime }) {
  const admin = User.findWithPasswordByEmail(config.admin.bootstrapUsername) || User.findWithPasswordByEmail('admin');
  const storedWeak = await storedAdminPasswordWeak(admin);
  const configuredWeak = config.admin.requireSecurePassword && config.admin.isWeakPassword(config.admin.bootstrapPassword);
  const missingConfiguredPassword = !config.admin.bootstrapPasswordConfigured;
  const weak = Boolean(storedWeak.weak || configuredWeak || missingConfiguredPassword);
  const defaultAdminPasswordActive = Boolean(storedWeak.matches.includes('1234'));
  const productionNoGo = weak && (isProductionRuntime() || !config.trialMode);
  const trialWarn = weak && !productionNoGo;
  const status = productionNoGo ? 'FAIL' : trialWarn ? 'WARN' : 'PASS';
  const reason = weak
    ? config.trialMode && !isProductionRuntime()
      ? 'default admin password intentionally kept for testing'
      : 'admin bootstrap password is missing or weak'
    : '';
  return {
    name: weak ? 'default_admin_password_warning' : 'admin_password_check',
    status,
    default_admin_password_active: defaultAdminPasswordActive,
    production_release_status: weak ? 'No-Go' : 'Go',
    reason,
    details: {
      username: config.admin.bootstrapUsername,
      password_configured: config.admin.bootstrapPasswordConfigured,
      password_weak: weak,
      configured_password_weak: configuredWeak || missingConfiguredPassword,
      stored_password_weak: storedWeak.weak,
      default_admin_password_active: defaultAdminPasswordActive,
      allow_default_password: config.admin.allowDefaultPassword,
      require_secure_password: config.admin.requireSecurePassword,
      default_admin_login_allowed: weak && defaultAdminCredentialsAllowed(),
      testing_only: weak && config.trialMode && !isProductionRuntime(),
      public_trial_status: weak ? 'Conditional Go' : 'Go',
      production_release_status: weak ? 'No-Go' : 'Go',
      reason,
      message: weak
        ? 'Default or weak admin password is active. Testing only. Change before external/public release.'
        : 'Admin bootstrap password is configured and not weak.',
      redacted: true,
    },
  };
}

function buildProductionBlockers({ adminPasswordProductionNoGo, adminPasswordNoGoReason }) {
  const blockers = [];
  if (adminPasswordProductionNoGo) blockers.push(adminPasswordNoGoReason || 'admin bootstrap password is missing or weak');
  if (config.filesystemDisk === 'local') blockers.push('R2/S3 live storage is not accepted');
  if (config.queueDriver === 'local') blockers.push('server-grade worker queue is not accepted');
  if (sqliteLike.has(String(config.databaseClient).toLowerCase())) blockers.push('server-grade production DB is not accepted');
  if (!config.geminiApiKey) blockers.push('Gemini live validation is not accepted');
  if (!config.claudeApiKey) blockers.push('Claude live validation is not accepted');
  if (!config.devpilotGatewayBaseUrl) blockers.push('DevPilot Gateway execution contract is missing');
  if (!config.forceHttps) blockers.push('HTTP to HTTPS redirect gate is not enabled');
  return blockers;
}

async function storedAdminPasswordWeak(admin) {
  if (!admin?.password) return { weak: true, matches: [] };
  const matches = [];
  for (const weakPassword of config.admin.weakPasswords || []) {
    if (await bcrypt.compare(weakPassword, admin.password)) matches.push(weakPassword);
  }
  return { weak: matches.length > 0, matches };
}

function isProductionRuntime() {
  return config.nodeEnv === 'production' || config.appEnv === 'production';
}

function isPublicRuntime() {
  const urls = [config.appUrl, config.publicUrl, config.domainCheckBaseUrl].filter(Boolean);
  return isProductionRuntime()
    || urls.some((value) => {
      try {
        const url = new URL(value);
        return url.protocol === 'https:' && !['localhost', '127.0.0.1', '0.0.0.0'].includes(url.hostname);
      } catch {
        return false;
      }
    });
}

function joinUrl(base, pathname) {
  const url = new URL(base);
  url.pathname = pathname;
  return url.toString();
}
