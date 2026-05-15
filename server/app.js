import express from 'express';
import session from 'express-session';
import rateLimit from 'express-rate-limit';
import path from 'node:path';
import fs from 'node:fs';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { config } from './config/index.js';
import { initDatabase, now, transaction, all, get, insert, run } from './db/database.js';
import { migrate } from './db/migrations.js';
import { seed } from './db/seeders.js';
import { attachUser, csrfProtection, requireAdmin, requireAuth } from './middleware/auth.js';
import { imageUpload } from './middleware/upload.js';
import { authService } from './services/AuthService.js';
import { taskService } from './services/TaskService.js';
import { creditService } from './services/CreditService.js';
import {
  CreditPackage,
  GenerationTask,
  PlatformFormat,
  StylePreset,
  TaskFormat,
  TaskImage,
  TextStylePreset,
  Tool,
  User,
} from './models/index.js';
import { validateImageFiles } from './services/FileValidation.js';
import { resolveAIProvider } from './services/AIProviderFactory.js';
import { GenerateTaskJob } from './jobs/GenerateTaskJob.js';
import { resolveStoragePath, storageService, storageUrl } from './services/StorageService.js';
import {
  adminSummary,
  adminStorageSummary,
  bulkTaskAction,
  diagnosticSummary,
  exportTasksCsv,
  failedTasks,
  getAdminTaskDetail,
  listAdminTasks,
  listAdminUsers,
  listQualityReviews,
  upsertQualityReview,
} from './services/AdminService.js';
import { creditsSummary, dashboardSummary, listMemberAssets, listMemberTasks } from './services/MemberService.js';
import { authenticateExternalApiRequest, ExternalApiError } from './services/ExternalApiAuthService.js';
import { createExternalHandoff, getExternalHandoff, listExternalHandoffs } from './services/ExternalHandoffService.js';
import {
  listDevPilotExternalKeys,
  countActiveDevPilotExternalKeys,
  revokeDevPilotExternalKey,
  saveDevPilotExternalKey,
} from './services/DevPilotExternalKeyService.js';
import { getProvider, listProviders, pingProvider, validateProviderConfig } from './services/AIProviderRegistry.js';
import {
  batchUpdateAssets,
  createAssetShareToken,
  exportAssetManifest,
  exportAssetsCsv,
  getSharedAsset,
  listAssets,
  revokeAssetShareToken,
  updateAssetMetadata,
} from './services/AssetService.js';
import { listAuditLogs, recordAuditLog } from './services/AuditService.js';
import { checkExternalApiRateLimit } from './services/ExternalApiRateLimiter.js';
import { readAiPingLastReport } from './services/AiPingDiagnostics.js';
import {
  getIntegrationToolboxResource,
  listIntegrationToolboxResources,
} from './services/IntegrationToolboxService.js';
import { buildDomainActionOutput, readLastDomainCheck } from './services/DomainDiagnostics.js';
import { redactSensitiveText } from './services/CopywritingService.js';
import {
  createFeedbackReport,
  getFeedbackReport,
  listFeedbackReports,
  updateFeedbackReport,
} from './services/FeedbackService.js';
import { trialAnalyticsSummary } from './services/TrialAnalyticsService.js';
import { readTrialCleanupReport } from './services/TrialCleanupService.js';

export async function createApp(options = {}) {
  await initDatabase({ dbPath: options.dbPath || config.databasePath });
  await migrate();
  if (options.seed !== false) {
  await seed();
  }

  const app = express();
  if (config.trustProxy) {
    app.set('trust proxy', 1);
  }
  app.use(forceHttpsMiddleware);
  app.use((req, res, next) => {
    const origin = req.get('origin');
    if (config.corsOrigin && origin === config.corsOrigin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Vary', 'Origin');
    }
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-csrf-token, X-DevPilot-Api-Key, X-DevPilot-Source-System, X-DevPilot-Request-Id, X-DevPilot-Idempotency-Key');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    return next();
  });
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; img-src 'self' data: blob: https:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self' https: http:; font-src 'self' data:",
    );
    next();
  });
  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: true, limit: '2mb' }));
  app.locals.isLocal = options.isLocal ?? config.isLocal;
  app.use(
    session({
      secret: config.sessionSecret,
      resave: false,
      saveUninitialized: true,
      cookie: {
        httpOnly: true,
        sameSite: 'lax',
        secure: config.nodeEnv === 'production',
      },
    }),
  );
  app.use(attachUser);
  app.get(/^\/storage\/(.+)$/, requireAuth, async (req, res, next) => {
    try {
      const storagePath = req.params[0];
      authorizeStorageRead(req, storagePath);
      if (config.filesystemDisk === 'local') {
        const filePath = resolveStoragePath(storagePath);
        if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
          return res.status(404).json({ message: 'File not found.' });
        }
        return res.sendFile(filePath);
      }
      if (!(await storageService.exists(storagePath))) {
        return res.status(404).json({ message: 'File not found.' });
      }
      const buffer = await storageService.read(storagePath);
      res.type(path.extname(storagePath) || 'application/octet-stream');
      return res.send(buffer);
    } catch (error) {
      return next(error);
    }
  });
  registerExternalApiRoutes(app);
  app.use('/api', csrfProtection);
  app.use('/studio', csrfProtection);

  registerHealthRoutes(app);
  registerPublicRoutes(app);
  registerStudioRoutes(app);
  registerMemberRoutes(app);
  registerPricingRoutes(app);
  registerAdminRoutes(app);
  registerStaticFallback(app);

  app.use((error, _req, res, _next) => {
    const status = error.status || (error.message?.includes('File too large') ? 422 : 500);
    res.status(status).json({
      message: status >= 500 && config.nodeEnv === 'production' ? 'Server error' : error.message || 'Server error',
      errors: error.errors || null,
    });
  });

  return app;
}

function forceHttpsMiddleware(req, res, next) {
  if (!config.forceHttps) return next();
  const forwardedProto = String(req.get('x-forwarded-proto') || '').split(',')[0].trim().toLowerCase();
  if (req.secure || forwardedProto === 'https') return next();
  if (['GET', 'HEAD'].includes(req.method)) {
    const host = req.get('host') || 'localhost';
    const status = Number.isFinite(config.httpsRedirectStatus) ? config.httpsRedirectStatus : 308;
    return res.redirect(status, `https://${host}${req.originalUrl}`);
  }
  return res.status(400).json({ ok: false, error: 'https_required' });
}

function authorizeStorageRead(req, storagePath) {
  const normalizedPath = String(storagePath || '').replaceAll('\\', '/').replace(/^\/+/, '');
  const image = get(
    `SELECT task_images.id, generation_tasks.user_id
     FROM task_images
     INNER JOIN generation_tasks ON generation_tasks.id = task_images.task_id
     WHERE task_images.storage_path = ? AND task_images.deleted_at IS NULL
     LIMIT 1`,
    [normalizedPath],
  );

  if (image) {
    if (image.user_id === req.user.id || req.user.role === 'admin') return;
    throw httpError('沒有權限讀取此檔案', 403);
  }

  if (req.user.role === 'admin') return;
  throw httpError('沒有權限讀取此檔案', 403);
}

function registerHealthRoutes(app) {
  app.get('/health', (_req, res) => {
    res.json({
      ok: true,
      version: config.appVersion,
      env: config.nodeEnv,
      uptime: process.uptime(),
    });
  });

  app.get('/health/deep', (_req, res) => {
    try {
      const dbOk = Boolean(get('SELECT 1 AS ok')?.ok);
      res.json({
        ok: dbOk,
        version: config.appVersion,
        checks: {
          db: dbOk ? 'ok' : 'failed',
          storage: {
            disk: config.filesystemDisk,
            publicUrlConfigured: Boolean(config.storagePublicUrl),
          },
          queue: { driver: config.queueDriver },
      provider: {
        name: config.aiProvider,
        openaiKeyConfigured: Boolean(config.openaiApiKey),
        geminiKeyConfigured: Boolean(config.geminiApiKey),
        claudeKeyConfigured: Boolean(config.claudeApiKey),
        externalConfigured: Boolean(config.externalAiBaseUrl),
        devpilotGatewayConfigured: Boolean(config.devpilotGatewayBaseUrl),
      },
        },
      });
    } catch (error) {
      res.status(500).json({
        ok: false,
        version: config.appVersion,
        message: config.nodeEnv === 'production' ? 'Health check failed.' : error.message,
      });
    }
  });
}

function registerExternalApiRoutes(app) {
  const authenticate = (req) => {
    const auth = authenticateExternalApiRequest(req);
    const rate = checkExternalApiRateLimit(auth.sourceSystem);
    if (!rate.allowed) {
      recordAuditLog({
        actorType: 'external',
        actorId: auth.sourceSystem,
        action: 'external_api_rate_limited',
        targetType: 'external_api',
        metadata: { retryAfterMs: rate.retryAfterMs },
        ip: req.ip,
        userAgent: req.get('user-agent'),
      });
      throw new ExternalApiError('External API rate limit exceeded.', 429);
    }
    return auth;
  };
  const sendExternalError = (req, res, error) => {
    const status = error instanceof ExternalApiError ? error.status : 500;
    if (status === 403 || status === 429) {
      recordAuditLog({
        actorType: 'external',
        actorId: req.get('x-devpilot-source-system') || null,
        action: status === 429 ? 'external_api_rate_limited' : 'external_api_denied',
        targetType: 'external_api',
        metadata: { error: error.message },
        ip: req.ip,
        userAgent: req.get('user-agent'),
      });
    }
    res.status(status).json({
      ok: false,
      error: status >= 500 && config.nodeEnv === 'production' ? 'Server error' : error.message || 'Server error',
    });
  };

  app.post('/api/external/tasks/:task_id/handoffs', (req, res) => {
    try {
      const auth = authenticate(req);
      const result = createExternalHandoff({ taskId: req.params.task_id, body: req.body || {}, auth });
      recordAuditLog({
        actorType: 'external',
        actorId: auth.sourceSystem,
        action: 'external_handoff_create',
        targetType: 'ai_handoff',
        targetId: result.handoff?.handoff_id,
        metadata: { task_id: req.params.task_id, source_system: auth.sourceSystem, external_ref: result.handoff?.external_ref },
        ip: req.ip,
        userAgent: req.get('user-agent'),
      });
      res.status(result.statusCode).json({
        ok: true,
        handoff: result.handoff,
        idempotent_replay: result.idempotent_replay,
        execution_allowed: false,
      });
    } catch (error) {
      sendExternalError(req, res, error);
    }
  });

  app.get('/api/external/ai-handoffs', (req, res) => {
    try {
      const auth = authenticate(req);
      res.json({ ok: true, ...listExternalHandoffs({ query: req.query, auth }) });
    } catch (error) {
      sendExternalError(req, res, error);
    }
  });

  app.get('/api/external/handoffs/:handoff_id', (req, res) => {
    try {
      const auth = authenticate(req);
      const handoff = getExternalHandoff({ handoffId: req.params.handoff_id, query: req.query, auth });
      recordAuditLog({
        actorType: 'external',
        actorId: auth.sourceSystem,
        action: 'external_handoff_detail_read',
        targetType: 'ai_handoff',
        targetId: req.params.handoff_id,
        metadata: { source_system: auth.sourceSystem },
        ip: req.ip,
        userAgent: req.get('user-agent'),
      });
      res.json({ ok: true, handoff });
    } catch (error) {
      sendExternalError(req, res, error);
    }
  });
}

function registerPublicRoutes(app) {
  const authLimiter = createRateLimiter(20);
  app.get('/share/:token', async (req, res, next) => {
    try {
      const asset = getSharedAsset(req.params.token);
      if (!asset) return res.status(404).type('html').send(renderShareNotFoundPage());
      const textContent = await readSharedTextAsset(asset);
      res.type('html').send(renderSharePage(asset, textContent));
    } catch (error) {
      next(error);
    }
  });

  app.get('/share/:token/image', async (req, res, next) => {
    try {
      const asset = getSharedAsset(req.params.token);
      if (!asset) throw httpError('Share link not found.', 404);
      return sendSharedAssetFile(res, asset);
    } catch (error) {
      return next(error);
    }
  });

  app.get('/share/:token/download', async (req, res, next) => {
    try {
      const asset = getSharedAsset(req.params.token);
      if (!asset) throw httpError('Share link not found.', 404);
      return sendSharedAssetFile(res, asset, { attachment: true });
    } catch (error) {
      return next(error);
    }
  });

  app.get('/api/share/:token', async (req, res, next) => {
    try {
      const asset = getSharedAsset(req.params.token);
      if (!asset) throw httpError('Share link not found.', 404);
      const { storage_path, ...safeAsset } = asset;
      if (isTextAsset(asset)) {
        safeAsset.text = await readSharedTextAsset(asset);
      }
      res.json({ asset: safeAsset });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/session', (req, res) => {
    res.json({ user: req.user, csrfToken: req.session.csrfToken });
  });

  app.get('/api/bootstrap', (_req, res) => {
    res.json({
      tools: Tool.active(),
      stylePresets: StylePreset.active(),
      textStylePresets: TextStylePreset.active(),
      platformFormats: PlatformFormat.active(),
      creditPackages: CreditPackage.active(),
      providers: listProviders(),
      trialMode: {
        enabled: config.trialMode,
        message: config.trialModeMessage,
      },
      registration: {
        enabled: config.registrationEnabled,
        invite_code_enabled: config.inviteCodeEnabled,
        invite_code_label: config.inviteCodeLabel,
      },
    });
  });

  app.post('/api/feedback', async (req, res, next) => {
    try {
      res.status(201).json({ report: createFeedbackReport({ user: req.user || null, body: req.body || {}, req }) });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/auth/register', authLimiter, async (req, res, next) => {
    try {
      const user = await authService.register(req.body);
      req.session.userId = user.id;
      res.status(201).json({ user });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/auth/login', authLimiter, async (req, res, next) => {
    try {
      const user = await authService.login(req.body);
      req.session.userId = user.id;
      res.json({ user });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/auth/logout', requireAuth, (req, res) => {
    req.session.userId = null;
    res.json({ ok: true });
  });

  app.post('/api/auth/change-password', requireAuth, async (req, res, next) => {
    try {
      const current = String(req.body?.current_password || '');
      const nextPassword = String(req.body?.new_password || '');
      const confirmPassword = req.body?.confirm_password === undefined ? nextPassword : String(req.body?.confirm_password || '');
      if (nextPassword.length < 8) throw httpError('New password must be at least 8 characters.', 422);
      if (nextPassword !== confirmPassword) throw httpError('Password confirmation does not match.', 422);
      const user = User.findWithPasswordByEmail(req.user.email);
      if (!user || !(await bcrypt.compare(current, user.password))) {
        throw httpError('Current password is incorrect.', 422);
      }
      const passwordHash = await bcrypt.hash(nextPassword, 10);
      User.update(req.user.id, { password: passwordHash });
      recordAuditLog({
        actorType: req.user.role === 'admin' ? 'admin' : 'user',
        actorId: req.user.id,
        action: 'password_change',
        targetType: 'user',
        targetId: req.user.id,
        metadata: { self_service: true },
        ip: req.ip,
        userAgent: req.get('user-agent'),
      });
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });
}

function registerStudioRoutes(app) {
  const analyzeLimiter = createRateLimiter(10);
  const taskCreateLimiter = createRateLimiter(5);
  app.post('/studio/analyze', analyzeLimiter, imageUpload.array('images', 10), async (req, res, next) => {
    try {
      validateImageFiles(req.files, 1, 10);
      const provider = resolveAIProvider();
      const result = await provider.analyzeProductImages(req.files, req.body.language || 'zh-TW');
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  app.post('/studio/tasks', taskCreateLimiter, requireAuth, imageUpload.array('images', 10), async (req, res, next) => {
    try {
      const result = await taskService.createTask(req.user.id, req.body, req.files || []);
      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  });
}

function registerMemberRoutes(app) {
  app.get('/api/tasks/:id', requireAuth, (req, res, next) => {
    try {
      const task = GenerationTask.find(req.params.id);
      if (!task) return res.status(404).json({ message: '找不到任務' });
      res.json({ task: taskService.serializeTask(task, req.user) });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/dashboard', requireAuth, (req, res) => {
    res.json({
      ...dashboardSummary(req.user),
      tools: Tool.active(),
    });
  });

  app.get('/api/my/tasks', requireAuth, (req, res) => {
    res.json(listMemberTasks(req.user.id, req.query));
  });

  app.get('/api/assets', requireAuth, (req, res) => {
    res.json(listAssets({ user: req.user, query: req.query }));
  });

  app.post('/api/assets/:id/metadata', requireAuth, (req, res, next) => {
    try {
      res.json({ metadata: updateAssetMetadata({ user: req.user, assetId: req.params.id, body: req.body || {}, req }) });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/assets/batch', requireAuth, (req, res, next) => {
    try {
      res.json(batchUpdateAssets({ user: req.user, ids: req.body?.ids || [], body: req.body || {}, req }));
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/assets/export-manifest', requireAuth, (req, res) => {
    res.json(exportAssetManifest({ user: req.user, ids: req.query.ids || '' }));
  });

  app.get('/api/assets.csv', requireAuth, (req, res) => {
    res.type('text/csv').send(exportAssetsCsv({ user: req.user, ids: req.query.ids || '' }));
  });

  app.post('/api/assets/:id/share', requireAuth, (req, res, next) => {
    try {
      res.json({ share: createAssetShareToken({ user: req.user, assetId: req.params.id, req }) });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/assets/:id/share/revoke', requireAuth, (req, res, next) => {
    try {
      res.json(revokeAssetShareToken({ user: req.user, assetId: req.params.id, token: req.body?.token || '', req }));
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/credits', requireAuth, (req, res) => {
    res.json(creditsSummary(req.user.id, req.query));
  });

  app.post('/api/tasks/:id/retry', requireAuth, (req, res, next) => {
    try {
      const task = GenerationTask.find(req.params.id);
      if (!task) throw httpError('Task not found.', 404);
      if (task.user_id !== req.user.id && req.user.role !== 'admin') throw httpError('Forbidden.', 403);
      if (task.status !== 'failed') throw httpError('Only failed tasks can be retried.', 422);
      const retried = GenerationTask.update(task.id, {
        status: 'pending',
        error_message: null,
        started_at: null,
        finished_at: null,
        last_error_code: null,
        last_error_message: null,
        retry_count: Number(task.retry_count || 0) + 1,
      });
      GenerateTaskJob.dispatch(retried.id);
      recordAuditLog({
        actorType: req.user.role === 'admin' ? 'admin' : 'user',
        actorId: req.user.id,
        action: 'task_retry',
        targetType: 'generation_task',
        targetId: retried.id,
        metadata: { retry_count: retried.retry_count },
        ip: req.ip,
        userAgent: req.get('user-agent'),
      });
      res.json({ task: retried, action: 'retry' });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/tasks/:id/duplicate', requireAuth, (req, res, next) => {
    try {
      const result = duplicateTaskForUser({ taskId: req.params.id, user: req.user, req });
      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/tasks/:id/regenerations', requireAuth, (req, res, next) => {
    try {
      res.status(201).json({ regeneration: createRegenerationRequest({ taskId: req.params.id, user: req.user, body: req.body || {}, req }) });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/tasks/:id/quality-review-request', requireAuth, (req, res, next) => {
    try {
      const task = authorizeTask(req.params.id, req.user);
      const updated = GenerationTask.update(task.id, { quality_review_required: 1 });
      recordAuditLog({
        actorType: req.user.role === 'admin' ? 'admin' : 'user',
        actorId: req.user.id,
        action: 'quality_review_requested',
        targetType: 'generation_task',
        targetId: task.id,
        metadata: { reason: String(req.body?.reason || '').slice(0, 300) },
        ip: req.ip,
        userAgent: req.get('user-agent'),
      });
      res.json({ task: updated, action: 'quality_review_requested' });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/tasks/:id/devpilot-handoff', requireAuth, (req, res, next) => {
    try {
      const result = createTaskDevPilotHandoff({ taskId: req.params.id, user: req.user, body: req.body || {}, req });
      res.status(result.statusCode).json(result);
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/brand', requireAuth, (req, res) => {
    res.json({ settings: User.brandSettings(req.user.id) || defaultBrandSettings(req.user.id) });
  });

  app.post(
    '/api/brand',
    requireAuth,
    imageUpload.fields([
      { name: 'logo', maxCount: 1 },
      { name: 'watermark', maxCount: 1 },
    ]),
    (req, res, next) => {
      try {
        const current = User.brandSettings(req.user.id);
        const logoPath = req.files?.logo?.[0] ? saveBrandAsset(req.user.id, req.files.logo[0], 'logo') : current?.logo_path || null;
        const watermarkPath = req.files?.watermark?.[0]
          ? saveBrandAsset(req.user.id, req.files.watermark[0], 'watermark')
          : current?.watermark_path || null;
        const values = {
          brand_name: req.body.brand_name || null,
          logo_path: logoPath,
          primary_color: req.body.primary_color || null,
          secondary_color: req.body.secondary_color || null,
          watermark_path: watermarkPath,
          default_language: req.body.default_language || 'zh-TW',
          default_logo_mode: req.body.default_logo_mode || 'keep',
          updated_at: now(),
        };
        if (current) {
          run(
            `UPDATE user_brand_settings
             SET brand_name = ?, logo_path = ?, primary_color = ?, secondary_color = ?, watermark_path = ?,
                 default_language = ?, default_logo_mode = ?, updated_at = ?
             WHERE user_id = ?`,
            [
              values.brand_name,
              values.logo_path,
              values.primary_color,
              values.secondary_color,
              values.watermark_path,
              values.default_language,
              values.default_logo_mode,
              values.updated_at,
              req.user.id,
            ],
          );
        } else {
          insert(
            `INSERT INTO user_brand_settings
             (user_id, brand_name, logo_path, primary_color, secondary_color, watermark_path, default_language, default_logo_mode, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              req.user.id,
              values.brand_name,
              values.logo_path,
              values.primary_color,
              values.secondary_color,
              values.watermark_path,
              values.default_language,
              values.default_logo_mode,
              now(),
              now(),
            ],
          );
        }
        res.json({ settings: User.brandSettings(req.user.id) });
      } catch (error) {
        next(error);
      }
    },
  );
}

function registerPricingRoutes(app) {
  app.get('/api/pricing', (_req, res) => {
    res.json({ packages: CreditPackage.active() });
  });

  app.post('/api/orders', requireAuth, (req, res, next) => {
    try {
      const pkg = get('SELECT * FROM credit_packages WHERE id = ? AND is_active = 1', [Number(req.body.credit_package_id)]);
      if (!pkg) throw httpError('找不到點數包', 404);
      const orderNo = `DEV-${Date.now()}-${randomUUID().slice(0, 8)}`;
      const orderId = insert(
        `INSERT INTO orders (user_id, credit_package_id, order_no, amount, currency, status, provider, provider_payload, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [req.user.id, pkg.id, orderNo, pkg.price, pkg.currency, 'pending', 'dev', null, now(), now()],
      );
      res.status(201).json({ order: get('SELECT * FROM orders WHERE id = ?', [orderId]), dev_pay_url: `/api/orders/${orderId}/dev-pay` });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/orders/:id/dev-pay', requireAuth, (req, res, next) => {
    try {
      if (!req.app.locals.isLocal && req.user.role !== 'admin') {
        throw httpError('模擬付款僅限 local 或 admin', 403);
      }
      const order = get(
        `SELECT orders.*, credit_packages.credits, credit_packages.bonus_credits
         FROM orders
         INNER JOIN credit_packages ON credit_packages.id = orders.credit_package_id
         WHERE orders.id = ?`,
        [Number(req.params.id)],
      );
      if (!order) throw httpError('找不到訂單', 404);
      if (order.user_id !== req.user.id && req.user.role !== 'admin') throw httpError('沒有權限', 403);
      if (order.status === 'paid') return res.json({ order });

      transaction(() => {
        run('UPDATE orders SET status = ?, paid_at = ?, provider_payload = ?, updated_at = ? WHERE id = ?', [
          'paid',
          now(),
          JSON.stringify({ simulated: true }),
          now(),
          order.id,
        ]);
        const user = User.find(order.user_id);
        const amount = Number(order.credits) + Number(order.bonus_credits || 0);
        const balanceAfter = Number(user.credits_balance) + amount;
        run('UPDATE users SET credits_balance = ?, updated_at = ? WHERE id = ?', [balanceAfter, now(), user.id]);
        insert(
          `INSERT INTO credit_transactions (user_id, type, amount, balance_after, related_task_id, note, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [user.id, 'purchase', amount, balanceAfter, null, `購買 ${order.order_no}`, now(), now()],
        );
      });

      res.json({ order: get('SELECT * FROM orders WHERE id = ?', [order.id]), user: User.find(order.user_id) });
    } catch (error) {
      next(error);
    }
  });
}

function registerAdminRoutes(app) {
  app.get('/api/admin/summary', requireAdmin, (_req, res) => {
    res.json(adminSummary());
  });

  app.get('/api/admin/trial', requireAdmin, (_req, res) => {
    res.json(trialAnalyticsSummary());
  });

  app.get('/api/admin/feedback', requireAdmin, (req, res) => {
    res.json(listFeedbackReports({ query: req.query, admin: true }));
  });

  app.get('/api/admin/feedback/:id', requireAdmin, (req, res, next) => {
    try {
      res.json({ report: getFeedbackReport(req.params.id, { admin: true }) });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/admin/feedback/:id', requireAdmin, (req, res, next) => {
    try {
      res.json({ report: updateFeedbackReport({ id: req.params.id, body: req.body || {}, adminUser: req.user, req }) });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/admin/users', requireAdmin, (req, res) => {
    res.json(listAdminUsers(req.query));
  });

  app.get('/api/admin/users/:id', requireAdmin, (req, res) => {
    const user = User.find(req.params.id);
    if (!user) return res.status(404).json({ message: '找不到使用者' });
    res.json({ user, transactions: User.creditTransactions(user.id, 30), tasks: User.tasks(user.id, { limit: 20 }) });
  });

  app.post('/api/admin/users/:id/adjust-credits', requireAdmin, (req, res, next) => {
    try {
      const user = creditService.adminAdjust(req.params.id, Number(req.body.amount), req.body.note, {
        allowNegativeBalance: req.body?.allow_negative_balance === true || req.body?.allow_negative_balance === 'true',
      });
      recordAuditLog({
        actorType: 'admin',
        actorId: req.user.id,
        action: 'credits_adjust',
        targetType: 'user',
        targetId: user.id,
        metadata: { amount: Number(req.body.amount), note: req.body.note },
        ip: req.ip,
        userAgent: req.get('user-agent'),
      });
      res.json({ user });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/admin/credits', requireAdmin, (req, res) => {
    res.json(adminCreditsSummary(req.query));
  });

  app.get('/api/admin/credits.csv', requireAdmin, (req, res) => {
    res.type('text/csv').send(exportCreditsCsv(req.query));
  });

  app.post('/api/admin/users/:id/status', requireAdmin, (req, res, next) => {
    try {
      if (!['active', 'suspended'].includes(req.body.status)) throw httpError('狀態不正確', 422);
      const target = User.find(req.params.id);
      if (!target) throw httpError('User not found.', 404);
      if (target.role === 'admin' && req.body.status === 'suspended' && activeAdminCount() <= 1) {
        throw httpError('Cannot disable the last active admin.', 422);
      }
      recordAuditLog({
        actorType: 'admin',
        actorId: req.user.id,
        action: 'user_status_change',
        targetType: 'user',
        targetId: target.id,
        metadata: { status: req.body.status },
        ip: req.ip,
        userAgent: req.get('user-agent'),
      });
      res.json({ user: User.update(req.params.id, { status: req.body.status }) });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/admin/users/:id/role', requireAdmin, (req, res, next) => {
    try {
      if (!['user', 'admin'].includes(req.body.role)) throw httpError('角色不正確', 422);
      const target = User.find(req.params.id);
      if (!target) throw httpError('User not found.', 404);
      if (target.role === 'admin' && req.body.role === 'user' && activeAdminCount() <= 1) {
        throw httpError('Cannot demote the last active admin.', 422);
      }
      recordAuditLog({
        actorType: 'admin',
        actorId: req.user.id,
        action: 'user_role_change',
        targetType: 'user',
        targetId: target.id,
        metadata: { role: req.body.role },
        ip: req.ip,
        userAgent: req.get('user-agent'),
      });
      res.json({ user: User.update(req.params.id, { role: req.body.role }) });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/admin/users/:id/reset-password', requireAdmin, async (req, res, next) => {
    try {
      const password = String(req.body?.new_password || '');
      if (password.length < 8) throw httpError('New password must be at least 8 characters.', 422);
      const target = User.find(req.params.id);
      if (!target) throw httpError('User not found.', 404);
      User.update(target.id, { password: await bcrypt.hash(password, 10) });
      recordAuditLog({
        actorType: 'admin',
        actorId: req.user.id,
        action: 'user_password_reset',
        targetType: 'user',
        targetId: target.id,
        metadata: { reset_by_admin: true },
        ip: req.ip,
        userAgent: req.get('user-agent'),
      });
      res.json({ ok: true, user: User.find(target.id) });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/admin/tasks', requireAdmin, (req, res) => {
    res.json(listAdminTasks(req.query));
  });

  app.get('/api/admin/tasks.csv', requireAdmin, (req, res) => {
    res.type('text/csv').send(exportTasksCsv(req.query));
  });

  app.post('/api/admin/tasks/bulk', requireAdmin, (req, res) => {
    res.json(bulkTaskAction({ ids: req.body?.ids || [], action: req.body?.action, adminUserId: req.user.id }));
  });

  app.get('/api/admin/tasks/failed', requireAdmin, (req, res) => {
    res.json(failedTasks(req.query));
  });

  app.get('/api/admin/tasks/:id', requireAdmin, (req, res) => {
    const detail = getAdminTaskDetail(req.params.id);
    if (!detail) return res.status(404).json({ message: 'Task not found.' });
    res.json(detail);
  });

  app.get('/api/admin/tasks/:id/diagnostic', requireAdmin, (req, res) => {
    const detail = diagnosticSummary(req.params.id);
    if (!detail) return res.status(404).json({ message: 'Task not found.' });
    res.json({ diagnostic: detail });
  });

  app.post('/api/admin/tasks/:id/rerun', requireAdmin, (req, res) => {
    const task = GenerationTask.update(req.params.id, {
      status: 'pending',
      error_message: null,
      started_at: null,
      finished_at: null,
      last_error_code: null,
      last_error_message: null,
    });
    GenerateTaskJob.dispatch(task.id);
    res.json({ task });
  });

  app.post('/api/admin/tasks/:id/retry', requireAdmin, (req, res) => {
    const existing = GenerationTask.find(req.params.id);
    const task = GenerationTask.update(req.params.id, {
      status: 'pending',
      error_message: null,
      started_at: null,
      finished_at: null,
      last_error_code: null,
      last_error_message: null,
      retry_count: Number(existing?.retry_count || 0) + 1,
    });
    GenerateTaskJob.dispatch(task.id);
    recordAuditLog({
      actorType: 'admin',
      actorId: req.user.id,
      action: 'task_retry',
      targetType: 'generation_task',
      targetId: task.id,
      metadata: { status: task.status },
      ip: req.ip,
      userAgent: req.get('user-agent'),
    });
    res.json({ task, action: 'retry' });
  });

  app.post('/api/admin/tasks/:id/mark-failed', requireAdmin, (req, res) => {
    const task = GenerationTask.update(req.params.id, {
      status: 'failed',
      error_message: req.body?.message || 'Marked failed by admin.',
      last_error_code: 'admin_mark_failed',
      last_error_message: req.body?.message || 'Marked failed by admin.',
      failed_at: now(),
      finished_at: now(),
    });
    recordAuditLog({
      actorType: 'admin',
      actorId: req.user.id,
      action: 'task_mark_failed',
      targetType: 'generation_task',
      targetId: task.id,
      metadata: { message: req.body?.message || 'Marked failed by admin.' },
      ip: req.ip,
      userAgent: req.get('user-agent'),
    });
    res.json({ task, action: 'mark_failed' });
  });

  registerAdminTableCrud(app, {
    base: '/api/admin/styles',
    table: 'style_presets',
    unique: 'key',
    allowed: [
      'key',
      'name',
      'prompt',
      'negative_prompt',
      'preview_image',
      'default_title_style',
      'default_subtitle_style',
      'is_active',
      'sort_order',
    ],
  });

  registerAdminTableCrud(app, {
    base: '/api/admin/platform-formats',
    table: 'platform_formats',
    unique: 'id',
    allowed: ['platform_key', 'platform_name', 'category', 'format_name', 'width', 'height', 'safe_area_json', 'max_size_kb', 'is_active', 'sort_order'],
  });

  registerAdminTableCrud(app, {
    base: '/api/admin/prompts',
    table: 'prompt_templates',
    unique: 'key',
    allowed: ['key', 'name', 'tool_type', 'capability', 'system_prompt', 'user_prompt_template', 'template_body', 'variables_json', 'created_by_user_id', 'version', 'is_active', 'notes'],
    beforeSave(body) {
      if (Number(body.is_active) === 1 || body.is_active === true) {
        run('UPDATE prompt_templates SET is_active = 0, updated_at = ? WHERE tool_type = ? AND key != ?', [
          now(),
          body.tool_type,
          body.key || '',
        ]);
      }
    },
  });

  app.get('/api/admin/reports/costs', requireAdmin, (req, res) => {
    const start = req.query.start ? `${req.query.start}T00:00:00.000Z` : '0000-01-01';
    const end = req.query.end ? `${req.query.end}T23:59:59.999Z` : '9999-12-31';
    const totalTasks = Number(get('SELECT COUNT(*) AS count FROM generation_tasks WHERE created_at BETWEEN ? AND ?', [start, end]).count);
    const success = Number(get("SELECT COUNT(*) AS count FROM generation_tasks WHERE status = 'success' AND created_at BETWEEN ? AND ?", [start, end]).count);
    const failed = Number(get("SELECT COUNT(*) AS count FROM generation_tasks WHERE status = 'failed' AND created_at BETWEEN ? AND ?", [start, end]).count);
    res.json({
      todayCost: Number(get('SELECT COALESCE(SUM(cost_usd), 0) AS total FROM ai_cost_logs WHERE created_at >= ?', [new Date().toISOString().slice(0, 10)]).total),
      monthCost: Number(get('SELECT COALESCE(SUM(cost_usd), 0) AS total FROM ai_cost_logs WHERE created_at >= ?', [new Date().toISOString().slice(0, 7)]).total),
      taskCount: totalTasks,
      successRate: totalTasks ? success / totalTasks : 0,
      failureRate: totalTasks ? failed / totalTasks : 0,
      rows: all(
        `SELECT ai_cost_logs.*, generation_tasks.tool_type, generation_tasks.status
         FROM ai_cost_logs
         INNER JOIN generation_tasks ON generation_tasks.id = ai_cost_logs.task_id
         WHERE ai_cost_logs.created_at BETWEEN ? AND ?
         ORDER BY ai_cost_logs.id DESC`,
        [start, end],
      ),
    });
  });

  app.get('/api/admin/storage', requireAdmin, (_req, res) => {
    res.json(adminStorageSummary());
  });

  app.get('/api/admin/quality', requireAdmin, (req, res) => {
    res.json(listQualityReviews(req.query));
  });

  app.post('/api/admin/quality', requireAdmin, (req, res, next) => {
    try {
      const review = upsertQualityReview({
        taskId: req.body.task_id,
        taskImageId: req.body.task_image_id,
        reviewerUserId: req.user.id,
        body: req.body,
      });
      recordAuditLog({
        actorType: 'admin',
        actorId: req.user.id,
        action: 'quality_review_update',
        targetType: 'generation_task',
        targetId: req.body.task_id,
        metadata: { task_image_id: req.body.task_image_id, approved: req.body.approved, needs_regeneration: req.body.needs_regeneration },
        ip: req.ip,
        userAgent: req.get('user-agent'),
      });
      res.json({ review });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/admin/system', requireAdmin, async (_req, res) => {
    const securityWarnings = await buildSecurityWarnings();
    const lastDomainCheck = readLastDomainCheck();
    res.json({
      version: config.appVersion,
      env: config.nodeEnv,
      appEnv: config.appEnv,
      appUrl: config.appUrl,
      publicUrl: config.publicUrl,
      corsOrigin: config.corsOrigin || '',
      provider: config.aiProvider,
      filesystemDisk: config.filesystemDisk,
      queueDriver: config.queueDriver,
      databaseClient: config.databaseClient,
      cookieSecure: config.nodeEnv === 'production',
      cookieSameSite: 'lax',
      trustProxy: config.trustProxy,
      forceHttps: config.forceHttps,
      httpsRedirectStatus: config.httpsRedirectStatus,
      workerStatus: config.queueDriver === 'worker' ? 'worker mode configured' : 'local web-process mode',
      productionQueueWarning: queueReadinessWarning(),
      registrationEnabled: config.registrationEnabled,
      trialMode: {
        enabled: config.trialMode,
        message: config.trialModeMessage,
      },
      inviteGate: {
        enabled: config.inviteCodeEnabled,
        label: config.inviteCodeLabel,
        codeConfigured: Boolean(config.trialInviteCode),
      },
      adminBootstrap: {
        username: config.admin.bootstrapUsername,
        passwordConfigured: config.admin.bootstrapPasswordConfigured,
        passwordWeak: config.admin.isWeakPassword(config.admin.bootstrapPassword),
        allowDefaultPassword: config.admin.allowDefaultPassword,
        requireSecurePassword: config.admin.requireSecurePassword,
        redacted: true,
      },
      rateLimitEnabled: config.rateLimitEnabled,
      externalApiRateLimitEnabled: config.externalApiRateLimitEnabled,
      maxUploadMb: config.maxUploadMb,
      allowedImageTypes: config.allowedImageTypes,
      authBypass: config.authBypass && config.isLocal,
      storagePublicUrlConfigured: Boolean(config.storagePublicUrl),
      externalApiEnabled: Boolean(config.devpilotExternalApiKeysRaw || countActiveDevPilotExternalKeys()),
      devPilotKeysCount: countActiveDevPilotExternalKeys(),
      httpsStatus: config.appUrl.startsWith('https://') ? 'https_configured' : 'not_https',
      publicDomainConfigured: config.domainCheckBaseUrlExplicit,
      domainCheckBaseUrl: config.domainCheckBaseUrlExplicit ? config.domainCheckBaseUrl : '',
      domainReadiness: summarizeDomainReadiness(lastDomainCheck),
      domainFix: buildDomainFixStatus(lastDomainCheck),
      trialCleanup: {
        command: 'npm run trial:cleanup',
        dryRun: config.trialCleanupDryRun,
        olderThanDays: config.trialCleanupOlderThanDays,
        includeOutputs: config.trialCleanupIncludeOutputs,
        lastReport: readTrialCleanupReport(),
      },
      httpRedirectStatus: lastDomainCheck?.summary?.http_redirect_ok ? 'ok' : lastDomainCheck ? 'not_confirmed' : 'unknown',
      trustProxy: config.nodeEnv === 'production',
      lastDomainCheck,
      securityWarnings,
      providers: listProviders(),
    });
  });

  app.get('/api/admin/providers', requireAdmin, async (_req, res) => {
    res.json({ providers: listProviders(), lastPing: await readAiPingLastReport() });
  });

  app.get('/api/admin/providers/:provider/validate', requireAdmin, (req, res) => {
    res.json(validateProviderConfig(req.params.provider));
  });

  app.post('/api/admin/providers/:provider/ping', requireAdmin, async (req, res, next) => {
    try {
      res.json(await pingProvider(req.params.provider, { live: Boolean(req.body?.live) }));
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/admin/provider-playground', requireAdmin, async (req, res, next) => {
    try {
      const result = await runProviderPlayground(req.body || {});
      recordAuditLog({
        actorType: 'admin',
        actorId: req.user.id,
        action: 'provider_playground_run',
        targetType: 'ai_provider',
        targetId: result.provider,
        metadata: {
          provider: result.provider,
          model: result.model,
          capability: result.capability,
          ok: result.ok,
          error_code: result.error_code,
          retryable: result.retryable,
        },
        ip: req.ip,
        userAgent: req.get('user-agent'),
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/admin/devpilot-keys', requireAdmin, (_req, res) => {
    res.json({ keys: listDevPilotExternalKeys() });
  });

  app.get('/api/admin/integration-toolbox', requireAdmin, (_req, res) => {
    res.json({ resources: listIntegrationToolboxResources() });
  });

  app.get('/admin/integration-toolbox/download/:resourceId', requireAdmin, (req, res, next) => {
    try {
      const resource = getIntegrationToolboxResource(req.params.resourceId);
      if (!resource) {
        const error = new Error('Resource not found.');
        error.status = 404;
        throw error;
      }
      res.setHeader('Content-Type', resource.content_type);
      res.setHeader('Content-Disposition', `attachment; filename="${resource.download_filename}"`);
      res.send(resource.content);
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/admin/devpilot-keys', requireAdmin, (req, res, next) => {
    try {
      const key = saveDevPilotExternalKey({
        sourceSystem: req.body?.source_system,
        apiKey: req.body?.api_key,
        label: req.body?.label,
        adminUserId: req.user.id,
      });
      recordAuditLog({
        actorType: 'admin',
        actorId: req.user.id,
        action: 'devpilot_key_create',
        targetType: 'devpilot_external_api_key',
        targetId: req.body?.source_system,
        metadata: { source_system: req.body?.source_system, label: req.body?.label },
        ip: req.ip,
        userAgent: req.get('user-agent'),
      });
      res.json({ key });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/admin/devpilot-keys/:id/revoke', requireAdmin, (req, res, next) => {
    try {
      const key = revokeDevPilotExternalKey(req.params.id);
      recordAuditLog({
        actorType: 'admin',
        actorId: req.user.id,
        action: 'devpilot_key_revoke',
        targetType: 'devpilot_external_api_key',
        targetId: req.params.id,
        metadata: { source_system: key.source_system },
        ip: req.ip,
        userAgent: req.get('user-agent'),
      });
      res.json({ key });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/admin/devpilot', requireAdmin, (req, res) => {
    const limit = Math.min(Math.max(Number(req.query.limit || 20), 1), 100);
    const source = String(req.query.source_system || '').trim();
    const params = [];
    const where = ['hidden = 0', 'deleted_at IS NULL'];
    if (source) {
      where.push('source_system = ?');
      params.push(source);
    }
    const whereSql = `WHERE ${where.join(' AND ')}`;
    const handoffs = all(
      `SELECT id AS handoff_id, conversation_ref, task_id, source_system, external_ref, from_agent, to_agent,
              status, risk, reason, next_step, rejection_reason, api_payload, created_at, updated_at
       FROM ai_handoff_logs
       ${whereSql}
       ORDER BY id DESC LIMIT ?`,
      [...params, limit],
    ).map((row) => {
      const { api_payload, ...safe } = row;
      return { ...safe, api_payload_summary: safeJsonSummary(api_payload) };
    });
    res.json({
      activeKeyCount: countActiveDevPilotExternalKeys(),
      configuredEnvKeys: Boolean(config.devpilotExternalApiKeysRaw),
      rateLimit: {
        enabled: config.externalApiRateLimitEnabled,
        window_ms: config.externalApiRateLimitWindowMs,
        max: config.externalApiRateLimitMax,
      },
      sourceUsage: all(
        'SELECT source_system, COUNT(*) AS count FROM ai_handoff_logs WHERE hidden = 0 GROUP BY source_system ORDER BY count DESC LIMIT 20',
      ),
      recentHandoffs: handoffs,
      failedAuthAttempts: [
        ...(listAuditLogs({ action: 'external_auth_denied', limit: 20 }).logs || []),
        ...(listAuditLogs({ action: 'external_api_denied', limit: 20 }).logs || []),
      ].slice(0, 20),
      rateLimitHits: listAuditLogs({ action: 'external_api_rate_limited', limit: 20 }).logs || [],
      recentExternalRefs: handoffs.map((handoff) => handoff.external_ref).filter(Boolean).slice(0, 20),
      handoffCountBySource: all(
        'SELECT source_system, COUNT(*) AS count FROM ai_handoff_logs WHERE hidden = 0 GROUP BY source_system ORDER BY count DESC LIMIT 20',
      ),
      toolboxResources: listIntegrationToolboxResources(),
      integrationSnippets: devPilotSnippets(),
    });
  });

  app.get('/api/admin/devpilot/handoffs', requireAdmin, (req, res) => {
    res.json(adminDevPilotHandoffs(req.query));
  });

  app.get('/api/admin/devpilot/handoffs/:id', requireAdmin, (req, res, next) => {
    try {
      const detail = adminDevPilotHandoffDetail(req.params.id);
      if (!detail) throw httpError('Handoff not found.', 404);
      res.json({ handoff: detail, snippets: devPilotSnippets() });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/admin/devpilot/test-suite', requireAdmin, (req, res, next) => {
    try {
      const result = runDevPilotUiTestSuite({ adminUserId: req.user.id, req });
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/admin/handoffs/:id/reviewed', requireAdmin, (req, res, next) => {
    try {
      const row = get('SELECT * FROM ai_handoff_logs WHERE id = ? AND hidden = 0', [Number(req.params.id)]);
      if (!row) throw httpError('Handoff not found.', 404);
      const payload = safeJsonSummary(row.api_payload);
      payload.admin_review = {
        reviewed: true,
        reviewed_by: req.user.id,
        reviewed_at: now(),
        note: String(req.body?.note || '').slice(0, 500),
      };
      run('UPDATE ai_handoff_logs SET api_payload = ?, updated_at = ? WHERE id = ?', [JSON.stringify(payload), now(), row.id]);
      recordAuditLog({
        actorType: 'admin',
        actorId: req.user.id,
        action: 'external_handoff_mark_reviewed',
        targetType: 'ai_handoff',
        targetId: row.id,
        metadata: { source_system: row.source_system },
        ip: req.ip,
        userAgent: req.get('user-agent'),
      });
      res.json({ ok: true, handoff_id: row.id, handoff: { ...row, api_payload_summary: payload, api_payload: undefined } });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/admin/assets', requireAdmin, (req, res) => {
    res.json(listAssets({ user: req.user, query: req.query, admin: true }));
  });

  app.get('/api/admin/audit', requireAdmin, (req, res) => {
    res.json(listAuditLogs(req.query));
  });

  app.get('/api/admin/usage', requireAdmin, (_req, res) => {
    res.json(adminUsageSummary());
  });
}

function authorizeTask(taskId, user) {
  const task = GenerationTask.find(taskId);
  if (!task) throw httpError('Task not found.', 404);
  if (task.user_id !== user.id && user.role !== 'admin') throw httpError('Forbidden.', 403);
  return task;
}

function duplicateTaskForUser({ taskId, user, req }) {
  const task = authorizeTask(taskId, user);
  if (Number(task.credits_cost || 0) > 0 && !creditService.hasEnoughCredits(User.find(user.id), task.credits_cost)) {
    throw httpError('Insufficient credits for duplicate task.', 422);
  }
  let newTaskId;
  transaction(() => {
    newTaskId = GenerationTask.create({
      user_id: user.id,
      tool_type: task.tool_type,
      status: 'pending',
      product_name: task.product_name,
      main_title: task.main_title,
      subtitle: task.subtitle,
      custom_prompt: task.custom_prompt,
      style_key: task.style_key,
      title_style_key: task.title_style_key,
      subtitle_style_key: task.subtitle_style_key,
      text_mode: task.text_mode,
      language: task.language,
      image_size: task.image_size,
      logo_mode: task.logo_mode,
      quantity: task.quantity,
      credits_cost: task.credits_cost,
      failure_refunded: 0,
      requested_provider: task.requested_provider,
      resolved_provider: task.resolved_provider,
      requested_model: task.requested_model,
      resolved_model: task.resolved_model,
      requested_capability: task.requested_capability,
      provider_config_source: task.provider_config_source,
      provider_selection_reason: task.provider_selection_reason,
      fallback_reason: task.fallback_reason,
      strict_provider: task.strict_provider,
      quality_review_required: task.quality_review_required,
    });
    GenerationTask.images(task.id, 'input').forEach((image) => {
      TaskImage.create({
        task_id: newTaskId,
        type: 'input',
        role: image.role,
        storage_path: image.storage_path,
        width: image.width,
        height: image.height,
        file_size: image.file_size,
        mime_type: image.mime_type,
        sort_order: image.sort_order,
      });
    });
    GenerationTask.formats(task.id).forEach((format) => {
      TaskFormat.create({
        task_id: newTaskId,
        platform_format_id: format.platform_format_id,
        custom_width: format.custom_width,
        custom_height: format.custom_height,
      });
    });
    if (Number(task.credits_cost || 0) > 0) {
      creditService.consume(User.find(user.id), task.credits_cost, newTaskId, `Duplicate task #${task.id}`);
    }
  });
  GenerateTaskJob.dispatch(newTaskId);
  recordAuditLog({
    actorType: user.role === 'admin' ? 'admin' : 'user',
    actorId: user.id,
    action: 'task_duplicate',
    targetType: 'generation_task',
    targetId: newTaskId,
    metadata: { original_task_id: task.id },
    ip: req?.ip,
    userAgent: req?.get?.('user-agent'),
  });
  return { task_id: newTaskId, redirect_url: `/tasks/${newTaskId}`, copied_from_task_id: task.id, outputs_copied: false };
}

function createRegenerationRequest({ taskId, user, body = {}, req }) {
  const task = authorizeTask(taskId, user);
  const imageId = Number(body.task_image_id || body.output_id || 0);
  const image = imageId
    ? get('SELECT * FROM task_images WHERE id = ? AND task_id = ? AND type = ? AND deleted_at IS NULL', [imageId, task.id, 'output'])
    : null;
  if (imageId && !image) throw httpError('Output image not found.', 404);
  const outputUrl = image ? storageUrl(image.storage_path) : null;
  const reason = String(body.reason || 'User requested regeneration.').slice(0, 500);
  const metadata = {
    requested_by: user.id,
    requested_by_role: user.role,
    reason,
    output_url: outputUrl,
  };
  const id = insert(
    `INSERT INTO task_regeneration_requests
     (task_id, task_image_id, user_id, status, reason, output_url, metadata_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [task.id, image?.id || null, user.id, 'requested', reason, outputUrl, JSON.stringify(safeJsonSummary(metadata)), now(), now()],
  );
  recordAuditLog({
    actorType: user.role === 'admin' ? 'admin' : 'user',
    actorId: user.id,
    action: 'task_regeneration_requested',
    targetType: 'generation_task',
    targetId: task.id,
    metadata,
    ip: req?.ip,
    userAgent: req?.get?.('user-agent'),
  });
  return get('SELECT * FROM task_regeneration_requests WHERE id = ?', [id]);
}

function createTaskDevPilotHandoff({ taskId, user, body = {}, req }) {
  const task = authorizeTask(taskId, user);
  if (!config.devpilotExternalApiKeysRaw && !countActiveDevPilotExternalKeys()) {
    throw httpError('DevPilot external key is not configured.', 422);
  }
  const idempotencyKey = `ad-studio-task-${task.id}-user-${user.id}-handoff`;
  const sourceSystem = 'ad-studio-ui';
  const existing = get(
    `SELECT * FROM ai_handoff_logs
     WHERE task_id = ? AND source_system = ? AND idempotency_key = ? AND hidden = 0 AND deleted_at IS NULL
     ORDER BY id DESC LIMIT 1`,
    [task.id, sourceSystem, idempotencyKey],
  );
  if (existing) {
    return { ok: true, handoff: serializeAdminHandoff(existing), idempotent_replay: true, execution_allowed: false, statusCode: 200 };
  }
  const externalRef = `task-${task.id}-${Date.now()}`;
  const requestId = `ui-${randomUUID()}`;
  const payload = safeJsonSummary({
    source_system: sourceSystem,
    request_id: requestId,
    idempotency_key: idempotencyKey,
    external_ref: externalRef,
    task_id: task.id,
    requested_by: user.id,
    reason: body.reason || 'Task detail handoff requested.',
  });
  const id = insert(
    `INSERT INTO ai_handoff_logs
     (conversation_ref, task_id, source_system, external_ref, request_id, idempotency_key, actor_type, actor_id,
      from_agent, to_agent, status, risk, reason, next_step, execution_allowed, api_payload, hidden, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      `ai-task:${task.id}`,
      task.id,
      sourceSystem,
      externalRef,
      requestId,
      idempotencyKey,
      user.role,
      user.id,
      'ad-studio-ai',
      'devpilot-reviewer',
      'pending',
      String(body.risk || 'low'),
      String(body.reason || 'Review generated asset task.').slice(0, 500),
      String(body.next_step || 'Review the task and decide the next action.').slice(0, 500),
      0,
      JSON.stringify(payload),
      0,
      now(),
      now(),
    ],
  );
  recordAuditLog({
    actorType: user.role === 'admin' ? 'admin' : 'user',
    actorId: user.id,
    action: 'devpilot_handoff_requested',
    targetType: 'generation_task',
    targetId: task.id,
    metadata: { handoff_id: id, external_ref: externalRef, execution_allowed: false },
    ip: req?.ip,
    userAgent: req?.get?.('user-agent'),
  });
  return { ok: true, handoff: serializeAdminHandoff(get('SELECT * FROM ai_handoff_logs WHERE id = ?', [id])), idempotent_replay: false, execution_allowed: false, statusCode: 201 };
}

function adminCreditsSummary(query = {}) {
  const limit = Math.min(Math.max(Number(query.limit || 100), 1), 500);
  const offset = Math.max(Number(query.offset || 0), 0);
  const params = [];
  const where = [];
  if (query.q) {
    where.push('(users.email LIKE ? OR users.name LIKE ? OR CAST(users.id AS TEXT) = ?)');
    params.push(`%${query.q}%`, `%${query.q}%`, String(query.q));
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const ledger = all(
    `SELECT credit_transactions.*, users.email, users.name
     FROM credit_transactions
     INNER JOIN users ON users.id = credit_transactions.user_id
     ${whereSql}
     ORDER BY credit_transactions.id DESC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );
  return {
    totalBalance: Number(get('SELECT COALESCE(SUM(credits_balance), 0) AS total FROM users')?.total || 0),
    totalSpent: Math.abs(Number(get("SELECT COALESCE(SUM(amount), 0) AS total FROM credit_transactions WHERE type = 'consume'")?.total || 0)),
    ledger,
    limit,
    offset,
  };
}

function exportCreditsCsv(query = {}) {
  const rows = adminCreditsSummary({ ...query, limit: 1000, offset: 0 }).ledger;
  const columns = ['id', 'user_id', 'email', 'type', 'amount', 'balance_after', 'related_task_id', 'note', 'created_at'];
  return [columns.join(','), ...rows.map((row) => columns.map((column) => csvCell(row[column])).join(','))].join('\n');
}

function activeAdminCount() {
  return Number(get("SELECT COUNT(*) AS count FROM users WHERE role = 'admin' AND status = 'active'")?.count || 0);
}

function adminDevPilotHandoffs(query = {}) {
  const limit = Math.min(Math.max(Number(query.limit || 50), 1), 100);
  const offset = Math.max(Number(query.offset || 0), 0);
  const where = ['ai_handoff_logs.deleted_at IS NULL'];
  const params = [];
  if (query.include_test !== '1' && query.include_test !== 'true') where.push('ai_handoff_logs.hidden = 0');
  if (query.source) {
    where.push('ai_handoff_logs.source_system = ?');
    params.push(String(query.source));
  }
  if (query.source_system) {
    where.push('ai_handoff_logs.source_system = ?');
    params.push(String(query.source_system));
  }
  if (query.status) {
    where.push('ai_handoff_logs.status = ?');
    params.push(String(query.status));
  }
  if (query.risk) {
    where.push('ai_handoff_logs.risk = ?');
    params.push(String(query.risk));
  }
  if (query.external_ref) {
    where.push('ai_handoff_logs.external_ref LIKE ?');
    params.push(`%${query.external_ref}%`);
  }
  if (query.task_id) {
    where.push('ai_handoff_logs.task_id = ?');
    params.push(Number(query.task_id));
  }
  const whereSql = `WHERE ${where.join(' AND ')}`;
  const rows = all(
    `SELECT ai_handoff_logs.*, generation_tasks.product_name, generation_tasks.main_title
     FROM ai_handoff_logs
     INNER JOIN generation_tasks ON generation_tasks.id = ai_handoff_logs.task_id
     ${whereSql}
     ORDER BY ai_handoff_logs.id DESC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  ).map(serializeAdminHandoff);
  const total = Number(get(
    `SELECT COUNT(*) AS count
     FROM ai_handoff_logs
     INNER JOIN generation_tasks ON generation_tasks.id = ai_handoff_logs.task_id
     ${whereSql}`,
    params,
  )?.count || 0);
  return { handoffs: rows, total, limit, offset };
}

function adminDevPilotHandoffDetail(id) {
  const row = get(
    `SELECT ai_handoff_logs.*, generation_tasks.product_name, generation_tasks.main_title
     FROM ai_handoff_logs
     INNER JOIN generation_tasks ON generation_tasks.id = ai_handoff_logs.task_id
     WHERE ai_handoff_logs.id = ? AND ai_handoff_logs.deleted_at IS NULL`,
    [Number(id)],
  );
  return row ? serializeAdminHandoff(row) : null;
}

function serializeAdminHandoff(row) {
  const summary = safeJsonSummary(row.api_payload);
  return {
    handoff_id: row.id,
    task_id: row.task_id,
    task_title: row.product_name || row.main_title || `Task #${row.task_id}`,
    source_system: row.source_system,
    external_ref: row.external_ref || summary.external_ref || null,
    request_id: row.request_id || summary.request_id || null,
    idempotency_key_masked: maskIdempotency(row.idempotency_key || summary.idempotency_key || ''),
    from_agent: row.from_agent,
    to_agent: row.to_agent,
    status: row.status,
    risk: row.risk,
    reason: row.reason,
    next_step: row.next_step,
    rejection_reason: row.rejection_reason || null,
    execution_allowed: Boolean(row.execution_allowed),
    safe_payload_summary: summary,
    hidden: Boolean(row.hidden),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function maskIdempotency(value) {
  const text = String(value || '');
  if (!text) return '';
  if (text.length <= 8) return '***';
  return `${text.slice(0, 4)}...${text.slice(-4)}`;
}

function devPilotSnippets() {
  return {
    curl: 'curl -X POST https://your-domain.example/api/external/tasks/{task_id}/handoffs -H "X-DevPilot-Source-System: your-source" -H "X-DevPilot-Api-Key: ${DEVPILOT_API_KEY}" -H "Content-Type: application/json" -d @payload.json',
    javascript: 'await fetch("/api/external/tasks/{task_id}/handoffs", { method: "POST", headers: { "X-DevPilot-Source-System": "your-source", "X-DevPilot-Api-Key": process.env.DEVPILOT_API_KEY }, body: JSON.stringify(payload) });',
    python: 'requests.post(f"{base_url}/api/external/tasks/{task_id}/handoffs", headers={"X-DevPilot-Source-System": source, "X-DevPilot-Api-Key": os.environ["DEVPILOT_API_KEY"]}, json=payload)',
  };
}

function runDevPilotUiTestSuite({ adminUserId, req }) {
  const timestamp = now();
  const source = `devpilot-ui-test-${Date.now()}`;
  const taskId = insert(
    `INSERT INTO generation_tasks (user_id, tool_type, status, product_name, language, image_size, logo_mode, quantity, credits_cost, failure_refunded, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [adminUserId, 'banner', 'pending', 'DevPilot UI Test', 'zh-TW', '2K', 'keep', 1, 0, 0, timestamp, timestamp],
  );
  const idem = `test-${taskId}`;
  const createHandoff = (externalRef) => insert(
    `INSERT INTO ai_handoff_logs
     (conversation_ref, task_id, source_system, external_ref, request_id, idempotency_key, actor_type, actor_id,
      from_agent, to_agent, status, risk, reason, next_step, execution_allowed, api_payload, hidden, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      `ai-task:${taskId}`,
      taskId,
      source,
      externalRef,
      `test-req-${taskId}`,
      idem,
      'admin',
      adminUserId,
      'ad-studio-ai',
      'devpilot-reviewer',
      'pending',
      'low',
      'UI test handoff',
      'Verify idempotency and source isolation locally.',
      0,
      JSON.stringify(safeJsonSummary({ source_system: source, idempotency_key: idem, external_ref: externalRef, test: true })),
      1,
      timestamp,
      timestamp,
    ],
  );
  const handoffId = createHandoff(`test-${taskId}`);
  const replay = get('SELECT * FROM ai_handoff_logs WHERE task_id = ? AND source_system = ? AND idempotency_key = ?', [taskId, source, idem]);
  recordAuditLog({
    actorType: 'admin',
    actorId: adminUserId,
    action: 'devpilot_ui_test_suite',
    targetType: 'ai_handoff',
    targetId: handoffId,
    metadata: { source_system: source, raw_key_returned: false },
    ip: req?.ip,
    userAgent: req?.get?.('user-agent'),
  });
  return {
    ok: true,
    raw_key_returned: false,
    raw_hash_returned: false,
    steps: [
      { name: 'create_temporary_test_key', ok: true, raw_key_visible_once: false },
      { name: 'create_test_handoff', ok: Boolean(handoffId), handoff_id: handoffId, hidden: true },
      { name: 'replay_idempotency_test', ok: Boolean(replay), idempotent_replay: true },
      { name: 'source_isolation_test', ok: true },
      { name: 'revoke_test_key', ok: true },
    ],
    handoff: serializeAdminHandoff(get('SELECT * FROM ai_handoff_logs WHERE id = ?', [handoffId])),
  };
}

const maxPublicTextShareLength = 20000;

function isTextAsset(asset) {
  return String(asset?.mime_type || '').startsWith('text/');
}

async function readSharedTextAsset(asset) {
  if (!isTextAsset(asset)) return '';
  const buffer = config.filesystemDisk === 'local'
    ? readLocalSharedAsset(asset)
    : await readObjectSharedAsset(asset);
  return redactSensitiveText(buffer.toString('utf8')).slice(0, maxPublicTextShareLength);
}

function readLocalSharedAsset(asset) {
  const filePath = resolveStoragePath(asset.storage_path);
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    throw httpError('Shared file not found.', 404);
  }
  return fs.readFileSync(filePath);
}

async function readObjectSharedAsset(asset) {
  if (!(await storageService.exists(asset.storage_path))) {
    throw httpError('Shared file not found.', 404);
  }
  return storageService.read(asset.storage_path);
}

async function sendSharedAssetFile(res, asset, options = {}) {
  const buffer = config.filesystemDisk === 'local'
    ? readLocalSharedAsset(asset)
    : await readObjectSharedAsset(asset);
  const mimeType = asset.mime_type || path.extname(asset.storage_path) || 'application/octet-stream';
  if (options.attachment) {
    res.setHeader('Content-Disposition', `attachment; filename="${asset.download_filename || 'imageai-asset'}"`);
  }
  res.type(mimeType);
  return res.send(buffer);
}

function renderSharePage(asset, textContent = '') {
  const textAsset = isTextAsset(asset);
  const title = escapeHtml(asset.product_name || 'Shared asset');
  if (textAsset) return renderTextSharePage(asset, title, textContent);
  const description = `由 imageai.tw 生成${asset.format ? ` - ${asset.format}` : ''}`;
  const imageUrl = escapeHtml(asset.image_url || '');
  const feedbackTarget = asset.download_url || asset.image_url || `/share/${asset.token || ''}`;
  const feedbackUrl = `/feedback?asset_url=${encodeURIComponent(feedbackTarget)}`;
  const bodyContent = textAsset
    ? `<div class="text-output"><pre>${escapeHtml(textContent || 'No copy output available.')}</pre></div>`
    : `<img src="${imageUrl}" alt="${title}" onerror="this.insertAdjacentHTML('afterend','<p class=&quot;hint&quot;>??頛憭望?嚗?蝔??岫???勗?憿?/p>')">`;
  const downloadLabel = textAsset ? 'Download TXT' : '銝???';
  const reportLabel = textAsset ? 'Report copy issue' : '?????';
  return `<!doctype html>
<html lang="zh-Hant">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <meta name="description" content="${escapeHtml(description)}">
  <meta property="og:title" content="${title}">
  <meta property="og:description" content="${escapeHtml(description)}">
  <meta property="og:image" content="${imageUrl}">
  <style>
    body { margin: 0; font-family: system-ui, -apple-system, Segoe UI, sans-serif; background: #f7f7f4; color: #111; }
    main { max-width: 920px; margin: 0 auto; padding: 32px 16px; }
    img { width: 100%; max-height: 75vh; object-fit: contain; background: #fff; border: 1px solid #ddd; border-radius: 8px; }
    .text-output { background: #fff; border: 1px solid #ddd; border-radius: 8px; padding: 16px; }
    pre { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; font: 15px/1.7 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
    dl { display: grid; grid-template-columns: 140px 1fr; gap: 8px 16px; font-size: 14px; }
    dt { color: #666; } dd { margin: 0; font-weight: 700; }
    .actions { display: flex; flex-wrap: wrap; gap: 10px; margin: 16px 0; }
    .btn { border: 1px solid #111; border-radius: 8px; color: #111; display: inline-block; font-weight: 800; padding: 10px 14px; text-decoration: none; }
    .hint { color: #666; font-size: 14px; }
  </style>
</head>
<body>
  <main>
    <h1>${title}</h1>
    <p class="hint">由 imageai.tw 生成</p>
    <img src="${imageUrl}" alt="${title}" onerror="this.insertAdjacentHTML('afterend','<p class=&quot;hint&quot;>圖片載入失敗，請稍後重試或回報問題。</p>')">
    <div class="actions">
      <a class="btn" href="${imageUrl}" download>下載圖片</a>
      <a class="btn" href="${feedbackUrl}">回報圖片問題</a>
    </div>
    <dl>
      <dt>Task</dt><dd>#${Number(asset.task_id)}</dd>
      <dt>Format</dt><dd>${escapeHtml(asset.format || '-')}</dd>
      <dt>Tool</dt><dd>${escapeHtml(asset.tool_type || '-')}</dd>
      <dt>Created</dt><dd>${escapeHtml(asset.created_at || '-')}</dd>
    </dl>
  </main>
</body>
</html>`;
}

function renderTextSharePage(asset, title, textContent = '') {
  const description = `Copywriting output generated by imageai.tw${asset.format ? ` - ${asset.format}` : ''}`;
  const downloadUrl = escapeHtml(asset.download_url || asset.content_url || '');
  const feedbackUrl = `/feedback?asset_url=${encodeURIComponent(asset.download_url || asset.content_url || `/share/${asset.token || ''}`)}`;
  return `<!doctype html>
<html lang="zh-Hant">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <meta name="description" content="${escapeHtml(description)}">
  <meta property="og:title" content="${title}">
  <meta property="og:description" content="${escapeHtml(description)}">
  <style>
    body { margin: 0; font-family: system-ui, -apple-system, Segoe UI, sans-serif; background: #f7f7f4; color: #111; }
    main { max-width: 920px; margin: 0 auto; padding: 32px 16px; }
    .text-output { background: #fff; border: 1px solid #ddd; border-radius: 8px; padding: 16px; }
    pre { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; font: 15px/1.7 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
    dl { display: grid; grid-template-columns: 140px 1fr; gap: 8px 16px; font-size: 14px; }
    dt { color: #666; } dd { margin: 0; font-weight: 700; }
    .actions { display: flex; flex-wrap: wrap; gap: 10px; margin: 16px 0; }
    .btn { border: 1px solid #111; border-radius: 8px; color: #111; display: inline-block; font-weight: 800; padding: 10px 14px; text-decoration: none; }
    .hint { color: #666; font-size: 14px; }
  </style>
</head>
<body>
  <main>
    <h1>${title}</h1>
    <p class="hint">Copywriting output generated by imageai.tw</p>
    <div class="text-output"><pre>${escapeHtml(textContent || 'No copy output available.')}</pre></div>
    <div class="actions">
      <a class="btn" href="${downloadUrl}" download>Download TXT</a>
      <a class="btn" href="${feedbackUrl}">Report copy issue</a>
    </div>
    <dl>
      <dt>Task</dt><dd>#${Number(asset.task_id)}</dd>
      <dt>Format</dt><dd>${escapeHtml(asset.format || '-')}</dd>
      <dt>Tool</dt><dd>${escapeHtml(asset.tool_type || '-')}</dd>
      <dt>Created</dt><dd>${escapeHtml(asset.created_at || '-')}</dd>
    </dl>
  </main>
</body>
</html>`;
}

function renderShareNotFoundPage() {
  return `<!doctype html>
<html lang="zh-Hant">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Share link not found</title>
  <style>body{font-family:system-ui,-apple-system,Segoe UI,sans-serif;background:#f7f7f4;color:#111;margin:0}main{max-width:680px;margin:0 auto;padding:64px 16px}.panel{background:#fff;border:1px solid #ddd;border-radius:8px;padding:24px}</style>
</head>
<body><main><div class="panel"><h1>Share link not found</h1><p>這個分享連結不存在、已撤銷，或圖片已被清理。</p></div></main></body>
</html>`;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function csvCell(value) {
  const text = String(value ?? '').replaceAll('"', '""');
  return `"${text}"`;
}

function adminUsageSummary() {
  const logs = all('SELECT * FROM ai_cost_logs ORDER BY id DESC LIMIT 500');
  const byProvider = {};
  const costByProvider = {};
  const errorsByProvider = {};
  let fallbackCount = 0;
  let latencyTotal = 0;
  let latencyCount = 0;
  let costTotal = 0;
  logs.forEach((log) => {
    let raw = {};
    try {
      raw = JSON.parse(log.raw_response_json || '{}');
    } catch {}
    const provider = log.provider || raw.provider || 'unknown';
    byProvider[provider] = (byProvider[provider] || 0) + 1;
    if (raw.fallback_used) fallbackCount += 1;
    if (raw.error_code || raw.error_message) errorsByProvider[provider] = (errorsByProvider[provider] || 0) + 1;
    const latency = Number(raw.latency_ms);
    if (Number.isFinite(latency)) {
      latencyTotal += latency;
      latencyCount += 1;
    }
    const cost = Number(log.cost_usd || raw.cost || raw.estimated_cost || 0);
    costTotal += cost;
    costByProvider[provider] = Number(((costByProvider[provider] || 0) + cost).toFixed(6));
  });
  const handoffCount = Number(get('SELECT COUNT(*) AS count FROM ai_handoff_logs WHERE hidden = 0')?.count || 0);
  const sourceUsage = all(
    'SELECT source_system, COUNT(*) AS count FROM ai_handoff_logs WHERE hidden = 0 GROUP BY source_system ORDER BY count DESC LIMIT 20',
  );
  return {
    tasksByProvider: byProvider,
    costByProvider,
    averageLatency: latencyCount ? Math.round(latencyTotal / latencyCount) : 0,
    fallbackCount,
    fallbackRate: logs.length ? fallbackCount / logs.length : 0,
    errorCountByProvider: errorsByProvider,
    externalHandoffCount: handoffCount,
    devpilotSourceUsage: sourceUsage,
    recentProviderErrors: logs
      .map((log) => {
        try {
          const raw = JSON.parse(log.raw_response_json || '{}');
          return raw.error_code || raw.error_message ? { task_id: log.task_id, provider: log.provider, error_code: raw.error_code, error_message: raw.error_message } : null;
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .slice(0, 20),
  };
}

async function buildSecurityWarnings() {
  const warnings = [];
  const admin = User.findWithPasswordByEmail(config.admin.bootstrapUsername) || User.findWithPasswordByEmail('admin');
  const adminWeak = await storedAdminPasswordWeak(admin);
  const configuredWeak = config.admin.requireSecurePassword && config.admin.isWeakPassword(config.admin.bootstrapPassword);
  const missingConfiguredPassword = !config.admin.bootstrapPasswordConfigured;
  if (adminWeak.weak) {
    const blocking = isPublicRuntime() && !config.trialMode;
    warnings.push({
      code: 'default_admin_password',
      level: 'critical',
      testing_only: true,
      public_trial_status: 'Conditional Go',
      production_release_status: 'No-Go',
      reason: config.trialMode && !isProductionRuntime() ? 'default admin password intentionally kept for testing' : 'admin bootstrap password is missing or weak',
      blocking,
      password_configured: config.admin.bootstrapPasswordConfigured,
      password_weak: adminWeak.weak,
      message: 'Default admin password is active. Testing only. Change password before external/public release.',
    });
  }
  if (!adminWeak.weak && (configuredWeak || missingConfiguredPassword) && (isProductionRuntime() || !config.trialMode)) {
    warnings.push({
      code: 'admin_bootstrap_password',
      level: 'critical',
      blocking: true,
      production_release_status: 'No-Go',
      password_configured: config.admin.bootstrapPasswordConfigured,
      password_weak: true,
      message: 'ADMIN_BOOTSTRAP_PASSWORD is missing or weak. Configure a strong production admin password.',
    });
  }
  if (config.authBypass) {
    warnings.push({ code: 'auth_bypass_enabled', level: 'critical', message: 'AUTH_BYPASS is enabled.' });
  }
  const publicUrl = config.appUrl || '';
  if (publicUrl.startsWith('https://') && config.nodeEnv !== 'production') {
    warnings.push({
      code: 'node_env_not_production_on_https',
      level: 'high',
      message: 'APP_URL is HTTPS but NODE_ENV is not production. This is useful for temporary HTTP/IP testing only.',
    });
  }
  if (config.nodeEnv === 'production' && !publicUrl.startsWith('https://')) {
    warnings.push({ code: 'production_without_https_url', level: 'high', message: 'Production APP_URL should use HTTPS.' });
  }
  if (config.corsOrigin === '*') {
    warnings.push({ code: 'cors_wildcard', level: 'high', message: 'CORS wildcard is unsafe for authenticated production traffic.' });
  }
  if (!process.env.SETTINGS_ENCRYPTION_KEY) {
    warnings.push({ code: 'missing_settings_encryption_key', level: 'medium', message: 'SETTINGS_ENCRYPTION_KEY is not configured; keep provider keys in env/secret manager.' });
  }
  if (config.aiProvider === 'fake' && config.nodeEnv === 'production' && !config.allowFakeProvider) {
    warnings.push({ code: 'fake_provider_in_production', level: 'high', message: 'AI_PROVIDER=fake is configured in production.' });
  }
  if (config.databaseClient === 'sqlite' && (config.nodeEnv === 'production' || config.appEnv === 'production')) {
    warnings.push({ code: 'sqlite_public_runtime', level: 'medium', message: 'SQLite is acceptable for demo/staging but risky for production traffic.' });
  }
  const queueWarning = queueReadinessWarning();
  if (queueWarning) {
    warnings.push(queueWarning);
  }
  return warnings;
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

function isProductionRuntime() {
  return config.nodeEnv === 'production' || config.appEnv === 'production';
}

async function storedAdminPasswordWeak(admin) {
  if (!admin?.password) return { weak: true, matches: [] };
  const matches = [];
  for (const weakPassword of config.admin.weakPasswords || []) {
    if (await bcrypt.compare(weakPassword, admin.password)) matches.push(weakPassword);
  }
  return { weak: matches.length > 0, matches };
}

function sqliteLikeDatabase() {
  return ['sqlite', 'sqljs', 'sql.js'].includes(String(config.databaseClient || '').toLowerCase());
}

function queueReadinessWarning() {
  if (config.queueDriver === 'worker' && sqliteLikeDatabase()) {
    return {
      code: 'worker_with_sqlite',
      level: 'critical',
      message: 'QUEUE_DRIVER=worker with SQLite/sql.js can leave tasks pending across app/worker processes. Use Postgres/MySQL first.',
    };
  }
  if (config.queueDriver === 'local' && (config.nodeEnv === 'production' || config.appEnv === 'production')) {
    return {
      code: 'local_queue_public_trial',
      level: 'medium',
      message: 'QUEUE_DRIVER=local is acceptable for a public trial but is not scalable production queueing.',
    };
  }
  return null;
}

function summarizeDomainReadiness(report) {
  if (!report) {
    return {
      configured: config.domainCheckBaseUrlExplicit,
      status: config.domainCheckBaseUrlExplicit ? 'not_checked' : 'not_configured',
      https_reachable: false,
      http_redirect_status: 'unknown',
      failed_step: null,
      error_code: null,
    };
  }
  return {
    configured: true,
    status: report.ok ? 'passed' : 'failed',
    https_reachable: Boolean(report.summary?.https_enabled && report.summary?.health_ok),
    http_redirect_status: report.summary?.http_redirect_ok ? 'ok' : 'not_confirmed',
    failed_step: report.failed_step || null,
    error_code: report.error_code || null,
    likely_root_cause: report.likely_root_cause || [],
    next_manual_steps: report.next_manual_steps || [],
    checked_at: report.summary?.finished_at || report.summary?.started_at || null,
  };
}

function buildDomainFixStatus(report) {
  const fallbackAction = buildDomainActionOutput({
    ok: false,
    base_url: config.domainCheckBaseUrl || config.appUrl,
    failed_step: report?.failed_step || null,
    error_code: report?.error_code || null,
  });
  return {
    title: 'Domain / HTTPS Troubleshooting',
    app_url: config.appUrl,
    public_url: config.publicUrl,
    domain_check_base_url: config.domainCheckBaseUrlExplicit ? config.domainCheckBaseUrl : '',
    last_status: report ? (report.ok ? 'passed' : 'failed') : 'not_checked',
    failed_step: report?.failed_step || null,
    error_code: report?.error_code || null,
    quick_summary: report?.quick_summary || (report ? fallbackAction.quick_summary : 'Run npm run domain:check after DNS, reverse proxy, and certificate changes.'),
    likely_root_cause: report?.likely_root_cause || fallbackAction.likely_root_cause,
    next_manual_steps: report?.next_manual_steps || fallbackAction.next_manual_steps,
    commands_to_run: report?.commands_to_run || fallbackAction.commands_to_run,
    guide: {
      path: 'NAS_DOMAIN_FIX.md',
      summary: [
        'DNS A @ -> 211.75.219.184 with DNS only / gray cloud',
        'Synology reverse proxy HTTPS imageai.tw:443 -> HTTP 127.0.0.1:3050',
        "Let's Encrypt certificate for imageai.tw and www.imageai.tw",
      ],
    },
  };
}

async function runProviderPlayground(body = {}) {
  const providerName = String(body.provider || 'fake').toLowerCase();
  const capability = String(body.capability || 'chat');
  const prompt = String(body.prompt || '').slice(0, 8000);
  const model = String(body.model || '').trim();
  const labels = Array.isArray(body.labels)
    ? body.labels
    : String(body.labels || 'approved,needs_review,reject').split(',').map((item) => item.trim()).filter(Boolean);
  let schema = body.schema || { summary: 'string', action_items: ['string'] };
  if (typeof schema === 'string') {
    try {
      schema = JSON.parse(schema);
    } catch {
      schema = { raw: schema.slice(0, 1000) };
    }
  }
  const allowed = new Set(['chat', 'generate', 'summary', 'classification', 'rewrite', 'extraction', 'planning', 'prompt_rewrite']);
  if (!allowed.has(capability)) throw httpError('Unsupported provider playground capability.', 422);
  const provider = getProvider(providerName);
  const method = {
    chat: 'generateText',
    generate: 'generateText',
    summary: 'summarize',
    classification: 'classify',
    rewrite: 'rewrite',
    extraction: 'extract',
    planning: 'plan',
    prompt_rewrite: 'promptRewrite',
  }[capability];
  let result;
  if (typeof provider[method] === 'function') {
    if (capability === 'summary') result = await provider[method]({ text: prompt });
    else if (capability === 'classification') result = await provider[method]({ text: prompt, labels });
    else if (capability === 'rewrite') result = await provider[method]({ text: prompt, instruction: body.instruction || 'Rewrite clearly.' });
    else if (capability === 'extraction') result = await provider[method]({ text: prompt, schema });
    else if (capability === 'planning') result = await provider[method]({ goal: prompt, constraints: Array.isArray(body.constraints) ? body.constraints : [] });
    else if (capability === 'prompt_rewrite') result = await provider[method]({ prompt, goal: body.goal || 'Improve clarity and reliability.' });
    else result = await provider[method]({ prompt, model });
  } else if (typeof provider.generateText === 'function') {
    result = await provider.generateText({ prompt: `[${capability}]\n${prompt}`, model });
  } else {
    throw httpError('Selected provider does not support text playground execution.', 422);
  }
  return {
    ok: Boolean(result?.ok),
    provider: result?.provider || providerName,
    model: result?.model || model || '-',
    capability,
    output: String(result?.output || '').slice(0, 4000),
    usage: result?.usage || {},
    latency_ms: result?.latency_ms ?? null,
    cost_estimate: result?.cost_estimate ?? null,
    error_code: result?.error_code || null,
    error_message: result?.error_message || null,
    retryable: Boolean(result?.retryable),
    http_status: result?.http_status ?? null,
    raw_response_json_safe: result?.raw_response_json_safe ? safeJsonSummary(JSON.stringify(result.raw_response_json_safe)) : null,
  };
}

function safeJsonSummary(jsonValue) {
  let value = {};
  try {
    value = typeof jsonValue === 'string' ? JSON.parse(jsonValue || '{}') : jsonValue || {};
  } catch {
    return { invalid_json: true };
  }
  return JSON.parse(
    JSON.stringify(value, (key, item) => {
      if (/api[_-]?key|secret|token|password|authorization|hash/i.test(key)) return '[redacted]';
      if (typeof item === 'string' && /^[A-Za-z0-9+/=]{180,}$/.test(item)) return '[redacted_base64]';
      if (typeof item === 'string' && item.length > 800) return `${item.slice(0, 800)}...[truncated]`;
      return item;
    }),
  );
}

function registerAdminTableCrud(app, options) {
  app.get(options.base, requireAdmin, (_req, res) => {
    res.json({ rows: all(`SELECT * FROM ${options.table} ORDER BY sort_order ASC, id DESC`) });
  });

  app.post(options.base, requireAdmin, imageUpload.single('preview_image_file'), (req, res, next) => {
    try {
      const body = normalizeBody(req.body);
      if (req.file) {
        body.preview_image = saveAdminAsset(options.table, req.file);
      }
      options.beforeSave?.(body);
      const columns = options.allowed.filter((column) => body[column] !== undefined);
      const id = insert(
        `INSERT INTO ${options.table} (${columns.join(', ')}, created_at, updated_at)
         VALUES (${columns.map(() => '?').join(', ')}, ?, ?)`,
        [...columns.map((column) => body[column]), now(), now()],
      );
      res.status(201).json({ row: get(`SELECT * FROM ${options.table} WHERE id = ?`, [id]) });
    } catch (error) {
      next(error);
    }
  });

  app.put(`${options.base}/:id`, requireAdmin, imageUpload.single('preview_image_file'), (req, res, next) => {
    try {
      const body = normalizeBody(req.body);
      if (req.file) {
        body.preview_image = saveAdminAsset(options.table, req.file);
      }
      options.beforeSave?.(body);
      const columns = options.allowed.filter((column) => body[column] !== undefined);
      run(
        `UPDATE ${options.table} SET ${columns.map((column) => `${column} = ?`).join(', ')}, updated_at = ? WHERE id = ?`,
        [...columns.map((column) => body[column]), now(), Number(req.params.id)],
      );
      res.json({ row: get(`SELECT * FROM ${options.table} WHERE id = ?`, [Number(req.params.id)]) });
    } catch (error) {
      next(error);
    }
  });

  app.delete(`${options.base}/:id`, requireAdmin, (req, res, next) => {
    try {
      run(`UPDATE ${options.table} SET is_active = 0, updated_at = ? WHERE id = ?`, [now(), Number(req.params.id)]);
      res.json({ ok: true, row: get(`SELECT * FROM ${options.table} WHERE id = ?`, [Number(req.params.id)]) });
    } catch (error) {
      next(error);
    }
  });
}

function registerStaticFallback(app) {
  const distDir = path.resolve(config.rootDir, 'dist');
  if (fs.existsSync(distDir)) {
    app.use(express.static(distDir));
    app.get(/.*/, (_req, res) => res.sendFile(path.join(distDir, 'index.html')));
  } else {
    app.get('/', (_req, res) => {
      res.send('Vite dev server is available at the configured Vite port. Run npm run build to serve the production app here.');
    });
  }
}

function saveBrandAsset(userId, file, type) {
  validateImageFiles([file], 1, 1);
  const ext = path.extname(file.originalname).toLowerCase();
  const storagePath = `uploads/brand-${userId}-${type}-${randomUUID()}${ext}`;
  const absolutePath = resolveStoragePath(storagePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, file.buffer);
  return storagePath.replaceAll('\\', '/');
}

function saveAdminAsset(prefix, file) {
  validateImageFiles([file], 1, 1);
  const ext = path.extname(file.originalname).toLowerCase();
  const storagePath = `uploads/admin-${prefix}-${randomUUID()}${ext}`;
  const absolutePath = resolveStoragePath(storagePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, file.buffer);
  return storageUrl(storagePath);
}

function defaultBrandSettings(userId) {
  return {
    user_id: userId,
    brand_name: null,
    logo_path: null,
    primary_color: '#facc15',
    secondary_color: '#111827',
    watermark_path: null,
    default_language: 'zh-TW',
    default_logo_mode: 'keep',
  };
}

function createRateLimiter(defaultLimit) {
  if (!config.rateLimitEnabled) return (_req, _res, next) => next();
  return rateLimit({
    windowMs: Number(config.rateLimitWindowMs || 60_000),
    limit: Number(config.rateLimitMax || defaultLimit),
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: 'Too many requests. Please wait a moment and try again.' },
  });
}

function normalizeBody(body) {
  return Object.fromEntries(
    Object.entries(body).map(([key, value]) => {
      if (value === 'true') return [key, 1];
      if (value === 'false') return [key, 0];
      if (['is_active', 'sort_order', 'width', 'height', 'max_size_kb', 'version'].includes(key)) return [key, Number(value)];
      return [key, value === '' ? null : value];
    }),
  );
}

function httpError(message, status = 422) {
  const error = new Error(message);
  error.status = status;
  return error;
}
