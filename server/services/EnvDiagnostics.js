import { config as appConfig } from '../config/index.js';

const weakSecrets = new Set(['', 'secret', 'password', 'dev-session-secret-change-me', 'change-me']);

function bool(value) {
  return String(value || 'false').toLowerCase() === 'true';
}

function value(env, key, fallback = '') {
  return env[key] ?? fallback;
}

function add(checks, level, key, message, suggestion = '') {
  checks.push({ level, key, message, suggestion });
}

export function runEnvDiagnostics(env = process.env, config = appConfig) {
  const checks = [];
  const nodeEnv = value(env, 'NODE_ENV', config.nodeEnv || 'development');
  const appEnv = value(env, 'APP_ENV', config.appEnv || nodeEnv);
  const isProduction = nodeEnv === 'production' || appEnv === 'production';
  const aiProvider = value(env, 'AI_PROVIDER', config.aiProvider || 'fake');
  const disk = value(env, 'FILESYSTEM_DISK', config.filesystemDisk || 'local');
  const queueDriver = value(env, 'QUEUE_DRIVER', config.queueDriver || 'local');
  const sessionSecret = value(env, 'SESSION_SECRET', config.sessionSecret || '');
  const databaseClient = String(value(env, 'DATABASE_CLIENT', config.databaseClient || 'sqlite')).toLowerCase();
  const sqliteLike = ['sqlite', 'sqljs', 'sql.js'].includes(databaseClient);

  [
    ['PORT', value(env, 'PORT', config.port || 3000)],
    ['APP_URL', value(env, 'APP_URL', config.appUrl || '') || value(env, 'PUBLIC_URL', '')],
    ['QUEUE_DRIVER', queueDriver],
    ['AI_PROVIDER', aiProvider],
    ['FILESYSTEM_DISK', disk],
    ['DATABASE', value(env, 'DATABASE_URL', config.databaseUrl || '') || value(env, 'DB_DATABASE', config.databasePath || '')],
  ].forEach(([key, current]) => {
    add(checks, current ? 'PASS' : 'WARN', key, current ? `${key} is set.` : `${key} is not set.`, `Set ${key} for staging/production.`);
  });

  if (!['sqlite', 'sqljs', 'sql.js', 'postgres', 'mysql'].includes(databaseClient)) {
    add(checks, 'FAIL', 'DATABASE_CLIENT', `Unsupported DATABASE_CLIENT=${databaseClient}.`, 'Use sqlite, postgres, or mysql.');
  } else if (!sqliteLike) {
    add(checks, 'WARN', 'DATABASE_CLIENT', `${databaseClient} is configured but this MVP runtime still uses sql.js locally.`, 'Plan a DB adapter migration before production.');
  } else if (isProduction && !bool(value(env, 'ALLOW_SQLITE_IN_PRODUCTION', config.allowSqliteInProduction))) {
    add(checks, 'FAIL', 'DATABASE_CLIENT', 'SQLite is blocked for production by default.', 'Use Postgres/MySQL in production, or set ALLOW_SQLITE_IN_PRODUCTION=true only for a controlled demo.');
  } else if (isProduction) {
    add(checks, 'WARN', 'DATABASE_CLIENT', 'SQLite is allowed in production by override.', 'Use this only for temporary demos and keep backups.');
  } else {
    add(checks, 'PASS', 'DATABASE_CLIENT', 'SQLite client selected.');
  }

  if (isProduction) {
    if (bool(value(env, 'AUTH_BYPASS', config.authBypass))) {
      add(checks, 'FAIL', 'AUTH_BYPASS', 'AUTH_BYPASS=true is forbidden in production.', 'Set AUTH_BYPASS=false.');
    }
    if (aiProvider === 'fake' && !bool(value(env, 'ALLOW_FAKE_PROVIDER', config.allowFakeProvider))) {
      add(checks, 'FAIL', 'AI_PROVIDER', 'AI_PROVIDER=fake is blocked in production by default.', 'Use openai/gemini/claude/external/devpilot-gateway or set ALLOW_FAKE_PROVIDER=true only for demos.');
    }
    if (weakSecrets.has(String(sessionSecret))) {
      add(checks, 'FAIL', 'SESSION_SECRET', 'SESSION_SECRET is missing or weak.', 'Set a long random SESSION_SECRET.');
    }
    if (bool(value(env, 'DEBUG', config.debug))) {
      add(checks, 'FAIL', 'DEBUG', 'DEBUG=true is unsafe in production.', 'Set DEBUG=false.');
    }
    if (queueDriver === 'worker' && sqliteLike) {
      add(checks, 'FAIL', 'QUEUE_DRIVER', 'QUEUE_DRIVER=worker with SQLite/sql.js is unsafe because separate processes may not share live task state.', 'Use Postgres/MySQL before enabling worker mode, or use QUEUE_DRIVER=local for public trial.');
    }
    if (queueDriver === 'local') {
      add(checks, 'WARN', 'QUEUE_DRIVER', 'QUEUE_DRIVER=local is acceptable for single-process public trial but is not scalable.', 'Use Postgres/MySQL with QUEUE_DRIVER=worker before production traffic.');
    }
  }

  if (aiProvider === 'openai') {
    if (!value(env, 'OPENAI_API_KEY', config.openaiApiKey || '')) {
      add(checks, 'FAIL', 'OPENAI_API_KEY', 'OPENAI_API_KEY is required for AI_PROVIDER=openai.', 'Set OPENAI_API_KEY in the runtime environment.');
    } else {
      add(checks, 'PASS', 'OPENAI_API_KEY', 'OPENAI_API_KEY is set.');
    }
    if (!value(env, 'OPENAI_TEXT_MODEL', config.openaiTextModel)) add(checks, 'WARN', 'OPENAI_TEXT_MODEL', 'Using fallback text model.', 'Set OPENAI_TEXT_MODEL explicitly.');
    if (!value(env, 'OPENAI_IMAGE_MODEL', config.openaiImageModel)) add(checks, 'WARN', 'OPENAI_IMAGE_MODEL', 'Using fallback image model.', 'Set OPENAI_IMAGE_MODEL explicitly.');
    const imageMode = value(env, 'OPENAI_IMAGE_MODE', config.openaiImageMode || 'auto');
    if (!['auto', 'edit', 'generate'].includes(imageMode)) {
      add(checks, 'FAIL', 'OPENAI_IMAGE_MODE', `Invalid OPENAI_IMAGE_MODE=${imageMode}.`, 'Use auto, edit, or generate.');
    }
    if (isProduction && !bool(value(env, 'AI_STRICT_PROVIDER', config.aiStrictProvider))) {
      add(checks, 'WARN', 'AI_STRICT_PROVIDER', 'AI_STRICT_PROVIDER=false allows fallback fake outputs.', 'Use true for strict production behavior, or document demo fallback risk.');
    }
  }

  if (aiProvider === 'gemini') {
    if (!value(env, 'GEMINI_API_KEY', config.geminiApiKey || '') && !value(env, 'GOOGLE_API_KEY') && !value(env, 'GOOGLE_GENERATIVE_AI_API_KEY')) {
      add(checks, 'FAIL', 'GEMINI_API_KEY', 'GEMINI_API_KEY is required for AI_PROVIDER=gemini.', 'Set GEMINI_API_KEY in the runtime environment.');
    } else {
      add(checks, 'PASS', 'GEMINI_API_KEY', 'Gemini API key is set.');
    }
    if (!value(env, 'GEMINI_MODEL', config.geminiModel)) add(checks, 'WARN', 'GEMINI_MODEL', 'Using fallback Gemini model.', 'Set GEMINI_MODEL explicitly.');
  }

  if (aiProvider === 'claude') {
    if (!value(env, 'ANTHROPIC_API_KEY', config.claudeApiKey || '') && !value(env, 'CLAUDE_API_KEY')) {
      add(checks, 'FAIL', 'ANTHROPIC_API_KEY', 'ANTHROPIC_API_KEY is required for AI_PROVIDER=claude.', 'Set ANTHROPIC_API_KEY in the runtime environment.');
    } else {
      add(checks, 'PASS', 'ANTHROPIC_API_KEY', 'Anthropic API key is set.');
    }
    if (!value(env, 'CLAUDE_MODEL', config.claudeModel)) add(checks, 'WARN', 'CLAUDE_MODEL', 'Using fallback Claude model.', 'Set CLAUDE_MODEL explicitly.');
  }

  if (aiProvider === 'devpilot-gateway') {
    if (!value(env, 'DEVPILOT_GATEWAY_BASE_URL', config.devpilotGatewayBaseUrl || '')) {
      add(checks, 'FAIL', 'DEVPILOT_GATEWAY_BASE_URL', 'DEVPILOT_GATEWAY_BASE_URL is required for AI_PROVIDER=devpilot-gateway.', 'Set the DevPilot Gateway base URL.');
    } else {
      add(checks, 'PASS', 'DEVPILOT_GATEWAY_BASE_URL', 'DevPilot Gateway base URL is set.');
    }
  }

  if (['r2', 's3'].includes(disk) && !value(env, 'STORAGE_PUBLIC_URL', config.storagePublicUrl || '')) {
    add(checks, isProduction ? 'FAIL' : 'WARN', 'STORAGE_PUBLIC_URL', 'STORAGE_PUBLIC_URL is required for public output images.', 'Set a public bucket/custom domain URL.');
  }

  if (disk === 'r2') {
    ['R2_ACCOUNT_ID', 'R2_BUCKET', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY'].forEach((key) => {
      if (!value(env, key)) add(checks, 'FAIL', key, `${key} is required for FILESYSTEM_DISK=r2.`, `Set ${key}.`);
    });
    const accountId = value(env, 'R2_ACCOUNT_ID');
    if (accountId) {
      const endpoint = `https://${accountId}.r2.cloudflarestorage.com`;
      add(checks, 'PASS', 'R2_ENDPOINT', `R2 endpoint will be ${endpoint}.`);
    }
  }

  if (disk === 's3') {
    ['S3_ENDPOINT', 'S3_REGION', 'S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'].forEach((key) => {
      if (!value(env, key)) add(checks, 'FAIL', key, `${key} is required for FILESYSTEM_DISK=s3.`, `Set ${key}.`);
    });
  }

  const ok = !checks.some((check) => check.level === 'FAIL');
  return { ok, env: { nodeEnv, appEnv, aiProvider, disk, queueDriver, databaseClient }, checks };
}

export function formatEnvDiagnostics(result) {
  const lines = [
    `[env] NODE_ENV=${result.env.nodeEnv} APP_ENV=${result.env.appEnv}`,
    `[env] AI_PROVIDER=${result.env.aiProvider} FILESYSTEM_DISK=${result.env.disk} QUEUE_DRIVER=${result.env.queueDriver}`,
  ];
  result.checks.forEach((check) => {
    lines.push(`[${check.level}] ${check.key}: ${check.message}${check.suggestion ? ` Suggestion: ${check.suggestion}` : ''}`);
  });
  lines.push(`[env] result=${result.ok ? 'passed' : 'failed'}`);
  return lines.join('\n');
}
