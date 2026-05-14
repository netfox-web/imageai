import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../..');
const defaultSessionSecret = 'dev-session-secret-change-me';
const weakAdminPasswords = ['1234', 'admin', 'password', 'test', 'demo', 'changeme'];
const adminBootstrapPasswordFromEnv = process.env.ADMIN_BOOTSTRAP_PASSWORD || '';
const adminBootstrapPassword = adminBootstrapPasswordFromEnv || '1234';
let packageVersion = '1.0.0';
try {
  packageVersion = JSON.parse(fs.readFileSync(path.resolve(rootDir, 'package.json'), 'utf8')).version || packageVersion;
} catch {}

export function isWeakAdminPassword(value = '') {
  return !String(value || '').trim() || weakAdminPasswords.includes(String(value || '').trim().toLowerCase());
}

export const config = {
  rootDir,
  appVersion: process.env.APP_VERSION || packageVersion,
  port: Number(process.env.PORT || 3000),
  appUrl: process.env.APP_URL || 'http://localhost:3000',
  publicUrl: process.env.PUBLIC_URL || process.env.APP_URL || 'http://localhost:3000',
  corsOrigin: process.env.CORS_ORIGIN || process.env.APP_URL || '',
  nodeEnv: process.env.NODE_ENV || 'development',
  appEnv: process.env.APP_ENV || process.env.NODE_ENV || 'development',
  debug: String(process.env.DEBUG || 'false') === 'true',
  trustProxy: String(process.env.TRUST_PROXY || 'false') === 'true',
  forceHttps: String(process.env.FORCE_HTTPS || 'false') === 'true',
  httpsRedirectStatus: Number(process.env.HTTPS_REDIRECT_STATUS || 308),
  authBypass: String(process.env.AUTH_BYPASS || 'false') === 'true',
  allowFakeProvider: String(process.env.ALLOW_FAKE_PROVIDER || 'false') === 'true',
  registrationEnabled: String(process.env.REGISTRATION_ENABLED || 'true') !== 'false',
  admin: {
    bootstrapUsername: process.env.ADMIN_BOOTSTRAP_USERNAME || 'admin',
    bootstrapPassword: adminBootstrapPassword,
    bootstrapPasswordConfigured: Boolean(adminBootstrapPasswordFromEnv),
    allowDefaultPassword: String(process.env.ALLOW_DEFAULT_ADMIN_PASSWORD || 'false') === 'true',
    requireSecurePassword: String(process.env.REQUIRE_SECURE_ADMIN_PASSWORD || 'true') !== 'false',
    weakPasswords: weakAdminPasswords,
    isWeakPassword: isWeakAdminPassword,
  },
  trialMode: String(process.env.TRIAL_MODE || 'true') === 'true',
  trialModeMessage: process.env.TRIAL_MODE_MESSAGE || '目前為測試站，資料與圖片可能會被清理。',
  inviteCodeEnabled: String(process.env.INVITE_CODE_ENABLED || 'false') === 'true',
  trialInviteCode: process.env.TRIAL_INVITE_CODE || '',
  inviteCodeLabel: process.env.INVITE_CODE_LABEL || 'Trial invite code',
  databaseClient: process.env.DATABASE_CLIENT || process.env.DB_CLIENT || process.env.DB_CONNECTION || 'sqlite',
  allowSqliteInProduction: String(process.env.ALLOW_SQLITE_IN_PRODUCTION || 'false') === 'true',
  databaseUrl: process.env.DATABASE_URL || null,
  databasePath: process.env.DB_DATABASE
    ? path.resolve(rootDir, process.env.DB_DATABASE)
    : path.resolve(rootDir, 'server/storage/database.sqlite'),
  uploadDir: path.resolve(rootDir, process.env.UPLOAD_DIR || 'server/storage/uploads'),
  outputDir: path.resolve(rootDir, process.env.OUTPUT_DIR || 'server/storage/outputs'),
  filesystemDisk: process.env.FILESYSTEM_DISK || 'local',
  storagePublicUrl: process.env.STORAGE_PUBLIC_URL || process.env.R2_PUBLIC_URL || process.env.AWS_PUBLIC_URL || null,
  s3: {
    endpoint: process.env.S3_ENDPOINT || process.env.AWS_ENDPOINT || '',
    region: process.env.S3_REGION || process.env.AWS_DEFAULT_REGION || 'auto',
    bucket: process.env.S3_BUCKET || process.env.AWS_BUCKET || '',
    accessKeyId: process.env.S3_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY || '',
  },
  r2: {
    accountId: process.env.R2_ACCOUNT_ID || '',
    bucket: process.env.R2_BUCKET || '',
    accessKeyId: process.env.R2_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || '',
  },
  aiProvider: process.env.AI_PROVIDER || 'fake',
  openaiApiKey: process.env.OPENAI_API_KEY || '',
  openaiBaseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
  openaiTextModel: process.env.OPENAI_TEXT_MODEL || 'gpt-4.1-mini',
  openaiImageModel: process.env.OPENAI_IMAGE_MODEL || 'gpt-image-1',
  openaiImageSize: process.env.OPENAI_IMAGE_SIZE || '1024x1024',
  openaiImageMode: process.env.OPENAI_IMAGE_MODE || 'auto',
  geminiApiKey: process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GOOGLE_API_KEY || '',
  geminiBaseUrl: process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com',
  geminiModel: process.env.GEMINI_MODEL || 'gemini-1.5-flash',
  claudeApiKey: process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY || '',
  claudeBaseUrl: process.env.CLAUDE_BASE_URL || 'https://api.anthropic.com',
  claudeModel: process.env.CLAUDE_MODEL || 'claude-3-5-haiku-latest',
  claudeApiVersion: process.env.CLAUDE_API_VERSION || '2023-06-01',
  aiStrictProvider: String(process.env.AI_STRICT_PROVIDER || 'false') === 'true',
  freeCreditsOnSignup: Number(process.env.FREE_CREDITS_ON_SIGNUP || 100),
  fakeTaskCost: Number(process.env.FAKE_TASK_COST || 0),
  openaiTaskEstimatedCostCredits: Number(process.env.OPENAI_TASK_ESTIMATED_COST_CREDITS || 10),
  geminiTaskEstimatedCostCredits: Number(process.env.GEMINI_TASK_ESTIMATED_COST_CREDITS || 8),
  claudeTaskEstimatedCostCredits: Number(process.env.CLAUDE_TASK_ESTIMATED_COST_CREDITS || 8),
  minCreditsToCreateTask: Number(process.env.MIN_CREDITS_TO_CREATE_TASK || 1),
  externalAiBaseUrl: process.env.EXTERNAL_AI_BASE_URL || '',
  externalAiApiKey: process.env.EXTERNAL_AI_API_KEY || '',
  devpilotGatewayBaseUrl: process.env.DEVPILOT_GATEWAY_BASE_URL || '',
  devpilotGatewayApiKey: process.env.DEVPILOT_GATEWAY_API_KEY || '',
  devpilotGatewayModel: process.env.DEVPILOT_GATEWAY_MODEL || 'devpilot-gateway',
  devpilotExternalApiKeysRaw: process.env.DEVPILOT_EXTERNAL_API_KEYS || '',
  devpilotExternalApiAllowAllSources: String(process.env.DEVPILOT_EXTERNAL_API_ALLOW_ALL_SOURCES || '0') === '1',
  refundOnFailure: String(process.env.REFUND_ON_TASK_FAILED || process.env.AI_REFUND_ON_FAILURE || 'true') === 'true',
  queueDriver: process.env.QUEUE_DRIVER || 'local',
  queuePollIntervalMs: Number(process.env.QUEUE_POLL_INTERVAL_MS || 3000),
  rateLimitEnabled: String(process.env.RATE_LIMIT_ENABLED || 'true') !== 'false',
  rateLimitWindowMs: Number(process.env.RATE_LIMIT_WINDOW_MS || 60000),
  rateLimitMax: Number(process.env.RATE_LIMIT_MAX || 60),
  externalApiRateLimitEnabled: String(process.env.EXTERNAL_API_RATE_LIMIT_ENABLED || 'true') !== 'false',
  externalApiRateLimitWindowMs: Number(process.env.EXTERNAL_API_RATE_LIMIT_WINDOW_MS || 60000),
  externalApiRateLimitMax: Number(process.env.EXTERNAL_API_RATE_LIMIT_MAX || 120),
  aiPingProvider: process.env.AI_PING_PROVIDER || '',
  aiPingModel: process.env.AI_PING_MODEL || '',
  aiPingPrompt: process.env.AI_PING_PROMPT || 'Return exactly one short sentence: AI_PING_OK',
  aiPingReportPath: process.env.AI_PING_REPORT_PATH || '',
  aiPingTimeoutMs: Number(process.env.AI_PING_TIMEOUT_MS || 30000),
  domainCheckBaseUrlExplicit: Boolean(process.env.DOMAIN_CHECK_BASE_URL),
  domainCheckBaseUrl: process.env.DOMAIN_CHECK_BASE_URL || process.env.APP_URL || 'http://localhost:3000',
  domainCheckAdminUser: process.env.DOMAIN_CHECK_ADMIN_USER || 'admin',
  domainCheckAdminPassword: process.env.DOMAIN_CHECK_ADMIN_PASSWORD || '',
  domainCheckReportPath: process.env.DOMAIN_CHECK_REPORT_PATH || './tmp/domain-check.json',
  domainCheckTimeoutMs: Number(process.env.DOMAIN_CHECK_TIMEOUT_MS || 15000),
  trialCleanupDryRun: String(process.env.TRIAL_CLEANUP_DRY_RUN || 'true') !== 'false',
  trialCleanupOlderThanDays: Number(process.env.TRIAL_CLEANUP_OLDER_THAN_DAYS || 7),
  trialCleanupIncludeOutputs: String(process.env.TRIAL_CLEANUP_INCLUDE_OUTPUTS || 'false') === 'true',
  trialCleanupReportPath: process.env.TRIAL_CLEANUP_REPORT_PATH || './tmp/trial-cleanup.json',
  allowTrialCleanupWrite: String(process.env.ALLOW_TRIAL_CLEANUP_WRITE || 'false') === 'true',
  maxUploadMb: Number(process.env.MAX_UPLOAD_MB || 10),
  allowedImageTypes: (process.env.ALLOWED_IMAGE_TYPES || 'image/png,image/jpeg,image/webp,image/bmp')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean),
  sessionSecret: process.env.SESSION_SECRET || defaultSessionSecret,
  hasDefaultSessionSecret: !process.env.SESSION_SECRET || process.env.SESSION_SECRET === defaultSessionSecret,
  isLocal: ['development', 'test'].includes(process.env.NODE_ENV || 'development'),
};

export function warnForProductionConfig(logger = console) {
  if (config.nodeEnv === 'production' && config.authBypass) {
    throw new Error('AUTH_BYPASS=true is not allowed in production.');
  }
  if (config.nodeEnv === 'production' && config.hasDefaultSessionSecret) {
    logger.warn('WARNING: SESSION_SECRET is not set. Configure a strong SESSION_SECRET before production deployment.');
    return true;
  }
  return false;
}
