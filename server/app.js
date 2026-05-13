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
  revokeDevPilotExternalKey,
  saveDevPilotExternalKey,
} from './services/DevPilotExternalKeyService.js';
import { listProviders, pingProvider, validateProviderConfig } from './services/AIProviderRegistry.js';
import { exportAssetManifest, listAssets, updateAssetMetadata } from './services/AssetService.js';
import { listAuditLogs, recordAuditLog } from './services/AuditService.js';
import { checkExternalApiRateLimit } from './services/ExternalApiRateLimiter.js';
import { readAiPingLastReport } from './services/AiPingDiagnostics.js';
import {
  getIntegrationToolboxResource,
  listIntegrationToolboxResources,
} from './services/IntegrationToolboxService.js';

export async function createApp(options = {}) {
  await initDatabase({ dbPath: options.dbPath || config.databasePath });
  await migrate();
  if (options.seed !== false) {
    await seed();
  }

  const app = express();
  if (config.nodeEnv === 'production') {
    app.set('trust proxy', 1);
  }
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
    });
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

  app.get('/api/assets/export-manifest', requireAuth, (req, res) => {
    res.json(exportAssetManifest({ user: req.user, ids: req.query.ids || '' }));
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
      });
      GenerateTaskJob.dispatch(retried.id);
      res.json({ task: retried, action: 'retry' });
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
      res.json({ user: creditService.adminAdjust(req.params.id, Number(req.body.amount), req.body.note) });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/admin/users/:id/status', requireAdmin, (req, res, next) => {
    try {
      if (!['active', 'suspended'].includes(req.body.status)) throw httpError('狀態不正確', 422);
      res.json({ user: User.update(req.params.id, { status: req.body.status }) });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/admin/users/:id/role', requireAdmin, (req, res, next) => {
    try {
      if (!['user', 'admin'].includes(req.body.role)) throw httpError('角色不正確', 422);
      res.json({ user: User.update(req.params.id, { role: req.body.role }) });
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
    const task = GenerationTask.update(req.params.id, {
      status: 'pending',
      error_message: null,
      started_at: null,
      finished_at: null,
      last_error_code: null,
      last_error_message: null,
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
    allowed: ['key', 'name', 'tool_type', 'system_prompt', 'user_prompt_template', 'version', 'is_active', 'notes'],
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

  app.get('/api/admin/system', requireAdmin, (_req, res) => {
    res.json({
      version: config.appVersion,
      env: config.nodeEnv,
      appEnv: config.appEnv,
      provider: config.aiProvider,
      filesystemDisk: config.filesystemDisk,
      queueDriver: config.queueDriver,
      registrationEnabled: config.registrationEnabled,
      rateLimitEnabled: config.rateLimitEnabled,
      maxUploadMb: config.maxUploadMb,
      allowedImageTypes: config.allowedImageTypes,
      authBypass: config.authBypass && config.isLocal,
      storagePublicUrlConfigured: Boolean(config.storagePublicUrl),
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
