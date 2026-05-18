import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import sharp from 'sharp';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../server/app.js';
import { all, get, insert, run } from '../server/db/database.js';
import { ensureAdmin, seed } from '../server/db/seeders.js';
import { creditService } from '../server/services/CreditService.js';
import { config, warnForProductionConfig } from '../server/config/index.js';
import { resolveAIProvider } from '../server/services/AIProviderFactory.js';
import { OpenAIProvider } from '../server/services/OpenAIProvider.js';
import { GeminiProvider } from '../server/services/providers/GeminiProvider.js';
import { ClaudeProvider } from '../server/services/providers/ClaudeProvider.js';
import {
  getAvailableCapabilities,
  listProviders,
  pingProvider,
  validateProviderConfig,
} from '../server/services/AIProviderRegistry.js';
import { renderPromptByKey, renderTemplateString } from '../server/services/PromptRenderer.js';
import {
  buildObjectStorageConfig,
  LocalStorageAdapter,
  ObjectStorageAdapter,
  resolveStoragePath,
} from '../server/services/StorageService.js';
import { queueService } from '../server/services/QueueService.js';
import { buildBannerPrompt } from '../server/services/BannerPromptBuilder.js';
import { buildOutputFilename, postProcessImage } from '../server/services/ImagePostProcessor.js';
import { GenerateTaskJob } from '../server/jobs/GenerateTaskJob.js';
import { formatSmokeError, parseSmokeEnv, runSmokeTest, verifyOutputUrls } from '../server/services/SmokeTestRunner.js';
import { formatStorageCheck, runStorageCheck } from '../server/services/StorageDiagnostics.js';
import { runEnvDiagnostics } from '../server/services/EnvDiagnostics.js';
import { adminStorageSummary, getAdminTaskDetail, safeRawResponse } from '../server/services/AdminService.js';
import { runQualityReview } from '../server/services/QualityReview.js';
import { classifyTaskError, recordTaskFailure } from '../server/services/TaskFailurePolicy.js';
import { recoverStuckTasks } from '../server/services/TaskRecoveryService.js';
import { runLocalCleanup } from '../server/services/CleanupService.js';
import { runDevReset } from '../server/services/DevResetService.js';
import { exportDemoData } from '../server/services/DemoExportService.js';
import { hashDevPilotApiKey } from '../server/services/DevPilotExternalKeyService.js';
import { listAssets } from '../server/services/AssetService.js';
import { listAuditLogs } from '../server/services/AuditService.js';
import { resetExternalApiRateLimits } from '../server/services/ExternalApiRateLimiter.js';
import { runRcLocalDiagnostics } from '../server/services/RcLocalDiagnostics.js';
import { readAiPingLastReport, runAiPing } from '../server/services/AiPingDiagnostics.js';
import { formatDomainCheck, runDomainCheck } from '../server/services/DomainDiagnostics.js';
import { runTrialCheck } from '../server/services/TrialDiagnostics.js';
import { assertSafeTrialPath, runTrialCleanup } from '../server/services/TrialCleanupService.js';
import { friendlyTaskError, imageLoadErrorMessage, parseTaskCostMeta, shortTaskError } from '../src/lib/taskMeta.js';
import { formatRcSmokeChecklist, runRcSmokeChecklist } from '../server/services/RcSmokeChecklist.js';
import { buildProviderCapabilityMatrix } from '../server/services/ProviderCapabilityMatrix.js';
import { buildMockImageToVideoResponse } from '../server/services/MockExternalProvider.js';
import { runExternalVideoSmoke } from '../server/services/ExternalVideoSmoke.js';
import { formatReleaseReadiness, runReleaseReadiness } from '../server/services/ReleaseReadiness.js';

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p94AAAAASUVORK5CYII=',
  'base64',
);

let app;

beforeEach(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ad-studio-test-'));
  app = await createApp({ dbPath: path.join(dir, 'database.sqlite') });
});

async function csrf(agent) {
  const response = await agent.get('/api/session');
  return response.body.csrfToken;
}

async function register(agent, email = `user-${Date.now()}@example.com`) {
  const token = await csrf(agent);
  const response = await agent
    .post('/api/auth/register')
    .set('x-csrf-token', token)
    .send({ name: 'Test User', email, password: 'password123', terms: true });
  expect(response.status).toBe(201);
  return { user: response.body.user, token };
}

async function createBannerTask(agent, token, overrides = {}) {
  const bootstrap = await agent.get('/api/bootstrap');
  const format = bootstrap.body.platformFormats.find((item) => item.platform_key === 'facebook');
  let req = agent
    .post('/studio/tasks')
    .set('x-csrf-token', token)
    .field('tool_type', 'banner')
    .field('style_key', 'minimal')
    .field('text_mode', 'merged')
    .field('image_size', overrides.image_size || '2K')
    .field('quantity', String(overrides.quantity || 1))
    .field('product_name', '測試商品')
    .field('main_title', '測試主標')
    .field('subtitle', '測試副標')
    .field('custom_prompt', overrides.custom_prompt || '乾淨背景')
    .field('platform_format_ids', JSON.stringify(overrides.platform_format_ids ?? [format.id]))
    .field('custom_formats', JSON.stringify(overrides.custom_formats ?? []))
    .field('input_roles', JSON.stringify(['cover']));

  if ('credits_cost' in overrides) {
    req = req.field('credits_cost', String(overrides.credits_cost));
  }
  if ('provider' in overrides) req = req.field('provider', overrides.provider);
  if ('model' in overrides) req = req.field('model', overrides.model);
  if ('capability' in overrides) req = req.field('capability', overrides.capability);
  if ('strict_provider' in overrides) req = req.field('strict_provider', String(overrides.strict_provider));
  if ('quality_review_required' in overrides) req = req.field('quality_review_required', String(overrides.quality_review_required));

  return req.attach('images', png, { filename: 'product.png', contentType: 'image/png' });
}

async function createImageToVideoTask(agent, token, overrides = {}) {
  let req = agent
    .post('/studio/tasks')
    .set('x-csrf-token', token)
    .field('tool_type', 'image_to_video')
    .field('product_name', overrides.product_name || 'Video Product')
    .field('main_title', overrides.main_title || 'Turn this into motion')
    .field('custom_prompt', overrides.custom_prompt || 'Create a short product video.')
    .field('metadata_json', JSON.stringify(overrides.metadata || { duration_seconds: 5, motion: 'slow product orbit' }));

  if ('provider' in overrides) req = req.field('provider', overrides.provider);
  if ('model' in overrides) req = req.field('model', overrides.model);
  if ('capability' in overrides) req = req.field('capability', overrides.capability);
  if ('strict_provider' in overrides) req = req.field('strict_provider', String(overrides.strict_provider));

  return req.attach('images', overrides.image || png, { filename: 'product.png', contentType: 'image/png' });
}

async function waitFor(predicate, timeout = 800) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  return false;
}

async function makeImage(width = 1024, height = 1024, color = '#facc15') {
  return sharp({
    create: {
      width,
      height,
      channels: 4,
      background: color,
    },
  })
    .png()
    .toBuffer();
}

async function makeTransparentCutoutImage(width = 256, height = 256) {
  const subject = await makeImage(Math.floor(width / 2), Math.floor(height / 2), '#22c55e');
  return sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{ input: subject, left: Math.floor(width / 4), top: Math.floor(height / 4) }])
    .png()
    .toBuffer();
}

function jsonResponse(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function textResponse(body, status = 200) {
  return new Response(body, { status });
}

describe('AI commerce generator MVP', () => {
  it('註冊成功贈送 15 點', async () => {
    const agent = request.agent(app);
    const { user } = await register(agent);
    expect(user.credits_balance).toBe(config.freeCreditsOnSignup);
  });

  it('credit_transactions 有 grant 紀錄', async () => {
    const agent = request.agent(app);
    const { user } = await register(agent);
    const tx = get('SELECT * FROM credit_transactions WHERE user_id = ? AND type = ?', [user.id, 'grant']);
    expect(tx.amount).toBe(config.freeCreditsOnSignup);
    expect(tx.balance_after).toBe(config.freeCreditsOnSignup);
  });

  it('未登入不能建立任務', async () => {
    const agent = request.agent(app);
    const token = await csrf(agent);
    const response = await createBannerTask(agent, token);
    expect(response.status).toBe(401);
  });

  it('點數不足不能建立任務', async () => {
    const agent = request.agent(app);
    const { user, token } = await register(agent);
    run('UPDATE users SET credits_balance = 0 WHERE id = ?', [user.id]);
    const response = await createBannerTask(agent, token);
    expect(response.status).toBe(422);
    expect(response.body.message).toContain('1');
  });

  it('banner 沒選尺寸不能建立任務', async () => {
    const agent = request.agent(app);
    const { token } = await register(agent);
    const response = await createBannerTask(agent, token, { platform_format_ids: [] });
    expect(response.status).toBe(422);
    expect(response.body.message).toContain('尺寸');
  });

  it('成功建立任務會扣點', async () => {
    const agent = request.agent(app);
    const { user, token } = await register(agent);
    const response = await createBannerTask(agent, token);
    expect(response.status).toBe(201);
    expect(get('SELECT credits_balance FROM users WHERE id = ?', [user.id]).credits_balance).toBe(config.freeCreditsOnSignup);
    const consume = get('SELECT * FROM credit_transactions WHERE user_id = ? AND type = ?', [user.id, 'consume']);
    expect(consume.amount).toBe(0);
  });

  it('任務建立後會建立 task_images', async () => {
    const agent = request.agent(app);
    const { token } = await register(agent);
    const response = await createBannerTask(agent, token);
    expect(response.status).toBe(201);
    const images = all('SELECT * FROM task_images WHERE task_id = ? AND type = ?', [response.body.task_id, 'input']);
    expect(images).toHaveLength(1);
  });

  it('使用者不能看別人的任務', async () => {
    const owner = request.agent(app);
    const guest = request.agent(app);
    const { token } = await register(owner, 'owner@example.com');
    const task = await createBannerTask(owner, token);
    await register(guest, 'guest@example.com');
    const response = await guest.get(`/api/tasks/${task.body.task_id}`);
    expect(response.status).toBe(403);
  });

  it('admin 可以看所有任務', async () => {
    const owner = request.agent(app);
    const admin = request.agent(app);
    const { token } = await register(owner, 'owner-admin-test@example.com');
    const task = await createBannerTask(owner, token);
    const adminSession = await register(admin, 'admin@example.com');
    run("UPDATE users SET role = 'admin' WHERE id = ?", [adminSession.user.id]);
    const response = await admin.get(`/api/tasks/${task.body.task_id}`);
    expect(response.status).toBe(200);
    expect(response.body.task.id).toBe(task.body.task_id);
  });

  it('失敗退點不會重複退', async () => {
    const previousFakeCost = config.fakeTaskCost;
    config.fakeTaskCost = 15;
    const agent = request.agent(app);
    const { user, token } = await register(agent);
    const response = await createBannerTask(agent, token, { custom_prompt: '__FAKE_FAIL__' });
    expect(response.status).toBe(201);
    const taskId = response.body.task_id;
    await waitFor(() => get('SELECT status FROM generation_tasks WHERE id = ?', [taskId])?.status === 'failed');
    creditService.refundFailedTask(taskId, 'manual duplicate call');
    const refreshed = get('SELECT credits_balance FROM users WHERE id = ?', [user.id]);
    const refunds = all('SELECT * FROM credit_transactions WHERE user_id = ? AND type = ?', [user.id, 'refund']);
    expect(refreshed.credits_balance).toBe(config.freeCreditsOnSignup);
    expect(refunds).toHaveLength(1);
    config.fakeTaskCost = previousFakeCost;
  });

  it('Seeder 可重複執行不重複', async () => {
    const before = get('SELECT COUNT(*) AS count FROM style_presets').count;
    await seed();
    await seed();
    const after = get('SELECT COUNT(*) AS count FROM style_presets').count;
    expect(after).toBe(before);
    expect(get('SELECT COUNT(*) AS count FROM platform_formats').count).toBe(36);
  });

  it('does not expose another user assets', async () => {
    const owner = request.agent(app);
    const guest = request.agent(app);
    const { token } = await register(owner, 'asset-owner@example.com');
    const task = await createBannerTask(owner, token);
    expect(task.status).toBe(201);
    await register(guest, 'asset-guest@example.com');

    const response = await guest.get('/api/assets');
    expect(response.status).toBe(200);
    expect(response.body.assets.some((asset) => asset.task_id === task.body.task_id)).toBe(false);
  });

  it('recalculates credits_cost on the backend', async () => {
    const agent = request.agent(app);
    const { user, token } = await register(agent);
    const response = await createBannerTask(agent, token, { credits_cost: 0 });

    expect(response.status).toBe(201);
    expect(response.body.credits_cost).toBe(config.fakeTaskCost);
    expect(get('SELECT credits_cost FROM generation_tasks WHERE id = ?', [response.body.task_id]).credits_cost).toBe(config.fakeTaskCost);
    expect(get('SELECT credits_balance FROM users WHERE id = ?', [user.id]).credits_balance).toBe(config.freeCreditsOnSignup);
  });

  it('post generator runs through task artifacts and credit ledger', async () => {
    const agent = request.agent(app);
    const { token } = await register(agent, 'post-generator@example.com');
    const response = await agent
      .post('/studio/tasks')
      .set('x-csrf-token', token)
      .field('tool_type', 'post_generator')
      .field('product_name', 'Serum')
      .field('main_title', 'Glow in one step')
      .field('subtitle', 'Lightweight daily care')
      .field('custom_prompt', 'Make it concise.')
      .field('metadata_json', JSON.stringify({ channel: 'instagram', tone: 'premium' }));

    expect(response.status).toBe(201);
    await waitFor(() => get('SELECT status FROM generation_tasks WHERE id = ?', [response.body.task_id])?.status === 'success');
    const artifact = get('SELECT * FROM task_artifacts WHERE task_id = ?', [response.body.task_id]);
    expect(artifact.kind).toBe('text');
    expect(artifact.visibility).toBe('private');
    expect(artifact.content_text).toContain('Serum');
    expect(get('SELECT requested_capability FROM generation_tasks WHERE id = ?', [response.body.task_id]).requested_capability).toBe(
      'post_generation',
    );
    const tx = get('SELECT * FROM credit_transactions WHERE related_task_id = ? AND type = ?', [response.body.task_id, 'consume']);
    expect(tx).toBeTruthy();
  });

  it('image_to_video can create a fake placeholder only when fake is explicitly selected', async () => {
    const previousDriver = config.queueDriver;
    const previousProvider = config.aiProvider;
    config.queueDriver = 'worker';
    config.aiProvider = 'fake';
    const agent = request.agent(app);
    const { token } = await register(agent, 'image-video-fake@example.com');
    const response = await createImageToVideoTask(agent, token, { provider: 'fake', capability: 'image_to_video' });
    expect(response.status).toBe(201);

    await GenerateTaskJob.handle(response.body.task_id);
    const task = get('SELECT * FROM generation_tasks WHERE id = ?', [response.body.task_id]);
    const artifact = get('SELECT * FROM task_artifacts WHERE task_id = ?', [response.body.task_id]);
    const artifactMeta = JSON.parse(artifact.metadata_json);

    expect(task.status).toBe('success');
    expect(task.requested_provider).toBe('fake');
    expect(task.resolved_provider).toBe('fake');
    expect(artifact.kind).toBe('video');
    expect(artifact.content_text).toContain('Fake provider video placeholder');
    expect(artifactMeta.fake).toBe(true);
    config.queueDriver = previousDriver;
    config.aiProvider = previousProvider;
  });

  it('image_to_video with OpenAI image model fails and refunds instead of writing a fake placeholder', async () => {
    const previousDriver = config.queueDriver;
    const previousProvider = config.aiProvider;
    const previousKey = config.openaiApiKey;
    const previousRefund = config.refundOnFailure;
    config.queueDriver = 'worker';
    config.aiProvider = 'fake';
    config.openaiApiKey = 'sk-test-openai-video';
    config.refundOnFailure = true;
    const agent = request.agent(app);
    const { user, token } = await register(agent, 'image-video-openai@example.com');
    const startingBalance = get('SELECT credits_balance FROM users WHERE id = ?', [user.id]).credits_balance;
    const response = await createImageToVideoTask(agent, token, {
      provider: 'openai',
      model: 'gpt-image-1',
      capability: 'image_to_video',
    });
    expect(response.status).toBe(201);
    expect(get('SELECT credits_balance FROM users WHERE id = ?', [user.id]).credits_balance).toBe(startingBalance - 40);

    await GenerateTaskJob.handle(response.body.task_id);
    const task = get('SELECT * FROM generation_tasks WHERE id = ?', [response.body.task_id]);
    const artifacts = all('SELECT * FROM task_artifacts WHERE task_id = ?', [response.body.task_id]);
    const outputs = all('SELECT * FROM task_images WHERE task_id = ? AND type = ?', [response.body.task_id, 'output']);
    const refund = get('SELECT * FROM credit_transactions WHERE related_task_id = ? AND type = ?', [response.body.task_id, 'refund']);
    const log = get('SELECT * FROM ai_cost_logs WHERE task_id = ? ORDER BY id DESC', [response.body.task_id]);
    const raw = JSON.parse(log.raw_response_json);

    expect(task.status).toBe('failed');
    expect(task.requested_provider).toBe('openai');
    expect(task.resolved_provider).toBe('openai');
    expect(task.last_error_code).toBe('provider_capability_unsupported');
    expect(task.error_message).toBe('目前尚未設定可用的圖生影片供應商，未產生影片，點數已退回。請到後台設定支援 image_to_video 的供應商後再試。');
    expect(artifacts).toHaveLength(0);
    expect(outputs).toHaveLength(0);
    expect(refund.amount).toBe(40);
    expect(get('SELECT credits_balance FROM users WHERE id = ?', [user.id]).credits_balance).toBe(startingBalance);
    expect(raw.error_code).toBe('provider_capability_unsupported');
    expect(raw.retryable).toBe(false);
    config.queueDriver = previousDriver;
    config.aiProvider = previousProvider;
    config.openaiApiKey = previousKey;
    config.refundOnFailure = previousRefund;
  });

  it('image_to_video with external provider creates a live video artifact without leaking secrets', async () => {
    const previousDriver = config.queueDriver;
    const previousProvider = config.aiProvider;
    const previousBaseUrl = config.externalAiBaseUrl;
    const previousApiKey = config.externalAiApiKey;
    const previousFetch = global.fetch;
    config.queueDriver = 'worker';
    config.aiProvider = 'fake';
    config.externalAiBaseUrl = 'https://external-video.test';
    config.externalAiApiKey = 'external-secret-test';

    try {
      global.fetch = async (url, options = {}) => {
        expect(url).toBe('https://external-video.test/image-to-video');
        expect(options.headers.Authorization).toBe('Bearer external-secret-test');
        const body = JSON.parse(options.body);
        expect(body.task_id).toBeTruthy();
        expect(body.tool_type).toBe('image_to_video');
        expect(body.prompt).toBe('Create a short product video.');
        expect(body.input_images[0].storage_path).toBeTruthy();
        expect(body.input_images[0].data_url).toMatch(/^data:image\/png;base64,/);
        expect(body.options.duration_seconds).toBe(5);
        expect(JSON.stringify(body)).not.toContain('external-secret-test');
        return new Response(
          JSON.stringify({
            ok: true,
            video_url: 'https://cdn.example.com/videos/product.mp4',
            mime_type: 'video/mp4',
            duration_seconds: 5,
            provider_job_id: 'ext-job-123',
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      };

      const agent = request.agent(app);
      const { token } = await register(agent, 'image-video-external@example.com');
      const response = await createImageToVideoTask(agent, token, {
        provider: 'external',
        capability: 'image_to_video',
        metadata: { duration_seconds: 5, aspect_ratio: '9:16', motion: 'slow orbit' },
      });
      expect(response.status).toBe(201);

      await GenerateTaskJob.handle(response.body.task_id);
      const task = get('SELECT * FROM generation_tasks WHERE id = ?', [response.body.task_id]);
      const artifact = get('SELECT * FROM task_artifacts WHERE task_id = ?', [response.body.task_id]);
      const artifactMeta = JSON.parse(artifact.metadata_json);
      const log = get('SELECT * FROM ai_cost_logs WHERE task_id = ? ORDER BY id DESC', [response.body.task_id]);
      const raw = JSON.parse(log.raw_response_json);

      expect(task.status).toBe('success');
      expect(task.resolved_provider).toBe('external');
      expect(artifact.kind).toBe('video');
      expect(artifact.visibility).toBe('private');
      expect(artifact.content_text).toBe('https://cdn.example.com/videos/product.mp4');
      expect(artifact.mime_type).toBe('video/mp4');
      expect(artifactMeta.source).toBe('external');
      expect(artifactMeta.provider).toBe('external');
      expect(artifactMeta.provider_job_id).toBe('ext-job-123');
      expect(artifactMeta.duration_seconds).toBe(5);
      expect(log.provider).toBe('external');
      expect(raw.raw.provider_job_id).toBe('ext-job-123');
      expect(JSON.stringify({ artifactMeta, raw })).not.toContain('external-secret-test');
    } finally {
      global.fetch = previousFetch;
      config.queueDriver = previousDriver;
      config.aiProvider = previousProvider;
      config.externalAiBaseUrl = previousBaseUrl;
      config.externalAiApiKey = previousApiKey;
    }
  });

  it('image_to_video with external provider fails and refunds when no video artifact is returned', async () => {
    const previousDriver = config.queueDriver;
    const previousProvider = config.aiProvider;
    const previousBaseUrl = config.externalAiBaseUrl;
    const previousApiKey = config.externalAiApiKey;
    const previousRefund = config.refundOnFailure;
    const previousFetch = global.fetch;
    config.queueDriver = 'worker';
    config.aiProvider = 'fake';
    config.externalAiBaseUrl = 'https://external-video.test';
    config.externalAiApiKey = 'external-secret-test';
    config.refundOnFailure = true;

    try {
      global.fetch = async () =>
        new Response(JSON.stringify({ ok: false, message: 'missing generated video' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });

      const agent = request.agent(app);
      const { user, token } = await register(agent, 'image-video-external-fail@example.com');
      const startingBalance = get('SELECT credits_balance FROM users WHERE id = ?', [user.id]).credits_balance;
      const response = await createImageToVideoTask(agent, token, {
        provider: 'external',
        capability: 'image_to_video',
      });
      expect(response.status).toBe(201);
      expect(get('SELECT credits_balance FROM users WHERE id = ?', [user.id]).credits_balance).toBe(startingBalance - 40);

      await GenerateTaskJob.handle(response.body.task_id);
      const task = get('SELECT * FROM generation_tasks WHERE id = ?', [response.body.task_id]);
      const artifacts = all('SELECT * FROM task_artifacts WHERE task_id = ?', [response.body.task_id]);
      const outputs = all('SELECT * FROM task_images WHERE task_id = ? AND type = ?', [response.body.task_id, 'output']);
      const refund = get('SELECT * FROM credit_transactions WHERE related_task_id = ? AND type = ?', [response.body.task_id, 'refund']);
      const log = get('SELECT * FROM ai_cost_logs WHERE task_id = ? ORDER BY id DESC', [response.body.task_id]);
      const raw = JSON.parse(log.raw_response_json);

      expect(task.status).toBe('failed');
      expect(task.last_error_code).toBe('external_provider_failed');
      expect(task.error_message).toBe('外部圖生影片供應商未回傳可用影片，未產生結果，點數已退回。');
      expect(artifacts).toHaveLength(0);
      expect(outputs).toHaveLength(0);
      expect(JSON.stringify(artifacts)).not.toContain('Fake provider video placeholder');
      expect(refund.amount).toBe(40);
      expect(get('SELECT credits_balance FROM users WHERE id = ?', [user.id]).credits_balance).toBe(startingBalance);
      expect(raw.error_code).toBe('external_provider_failed');
      expect(raw.retryable).toBe(false);
    } finally {
      global.fetch = previousFetch;
      config.queueDriver = previousDriver;
      config.aiProvider = previousProvider;
      config.externalAiBaseUrl = previousBaseUrl;
      config.externalAiApiKey = previousApiKey;
      config.refundOnFailure = previousRefund;
    }
  });

  it('image_to_video with unconfigured external provider fails and never creates a fake placeholder', async () => {
    const previousDriver = config.queueDriver;
    const previousProvider = config.aiProvider;
    const previousBaseUrl = config.externalAiBaseUrl;
    const previousApiKey = config.externalAiApiKey;
    const previousFakeCost = config.fakeTaskCost;
    const previousRefund = config.refundOnFailure;
    config.queueDriver = 'worker';
    config.aiProvider = 'fake';
    config.externalAiBaseUrl = '';
    config.externalAiApiKey = '';
    config.fakeTaskCost = 5;
    config.refundOnFailure = true;

    try {
      const agent = request.agent(app);
      const { user, token } = await register(agent, 'image-video-external-unconfigured@example.com');
      const startingBalance = get('SELECT credits_balance FROM users WHERE id = ?', [user.id]).credits_balance;
      const response = await createImageToVideoTask(agent, token, {
        provider: 'external',
        capability: 'image_to_video',
      });
      expect(response.status).toBe(201);
      expect(get('SELECT credits_balance FROM users WHERE id = ?', [user.id]).credits_balance).toBe(startingBalance - 5);

      await GenerateTaskJob.handle(response.body.task_id);
      const task = get('SELECT * FROM generation_tasks WHERE id = ?', [response.body.task_id]);
      const artifacts = all('SELECT * FROM task_artifacts WHERE task_id = ?', [response.body.task_id]);
      const refund = get('SELECT * FROM credit_transactions WHERE related_task_id = ? AND type = ?', [response.body.task_id, 'refund']);

      expect(task.status).toBe('failed');
      expect(task.requested_provider).toBe('external');
      expect(task.resolved_provider).toBe('fake');
      expect(task.last_error_code).toBe('provider_capability_unsupported');
      expect(artifacts).toHaveLength(0);
      expect(refund.amount).toBe(5);
      expect(get('SELECT credits_balance FROM users WHERE id = ?', [user.id]).credits_balance).toBe(startingBalance);
    } finally {
      config.queueDriver = previousDriver;
      config.aiProvider = previousProvider;
      config.externalAiBaseUrl = previousBaseUrl;
      config.externalAiApiKey = previousApiKey;
      config.fakeTaskCost = previousFakeCost;
      config.refundOnFailure = previousRefund;
    }
  });

  it('sensitive media tasks require consent, audit, and private artifacts', async () => {
    const agent = request.agent(app);
    const { token } = await register(agent, 'sensitive-media@example.com');

    const blocked = await agent
      .post('/studio/tasks')
      .set('x-csrf-token', token)
      .field('tool_type', 'face_swap')
      .field('product_name', 'Avatar test')
      .attach('images', png, { filename: 'source.png', contentType: 'image/png' })
      .attach('images', png, { filename: 'target.png', contentType: 'image/png' });
    expect(blocked.status).toBe(422);
    expect(blocked.body.message).toContain('Consent');

    const allowed = await agent
      .post('/studio/tasks')
      .set('x-csrf-token', token)
      .field('tool_type', 'face_swap')
      .field('product_name', 'Avatar test')
      .field('consent_granted', 'true')
      .field('consent_statement', 'signed release #123')
      .field('metadata_json', JSON.stringify({ subject: 'released model' }))
      .attach('images', png, { filename: 'source.png', contentType: 'image/png' })
      .attach('images', png, { filename: 'target.png', contentType: 'image/png' });

    expect(allowed.status).toBe(201);
    await waitFor(() => get('SELECT status FROM generation_tasks WHERE id = ?', [allowed.body.task_id])?.status === 'success');
    const task = get('SELECT * FROM generation_tasks WHERE id = ?', [allowed.body.task_id]);
    expect(task.privacy_mode).toBe('private');
    expect(task.consent_required).toBe(1);
    expect(task.consent_granted).toBe(1);
    const audit = get('SELECT * FROM audit_logs WHERE action = ? AND target_id = ?', ['sensitive_ai_task_consent', String(allowed.body.task_id)]);
    expect(audit).toBeTruthy();
    const artifact = get('SELECT * FROM task_artifacts WHERE task_id = ?', [allowed.body.task_id]);
    expect(artifact.visibility).toBe('private');
  });

  it('rejects invalid upload formats', async () => {
    const agent = request.agent(app);
    const { token } = await register(agent);
    const bootstrap = await agent.get('/api/bootstrap');
    const format = bootstrap.body.platformFormats.find((item) => item.platform_key === 'facebook');

    const response = await agent
      .post('/studio/tasks')
      .set('x-csrf-token', token)
      .field('tool_type', 'banner')
      .field('style_key', 'minimal')
      .field('text_mode', 'merged')
      .field('platform_format_ids', JSON.stringify([format.id]))
      .field('input_roles', JSON.stringify(['cover']))
      .attach('images', Buffer.from('not an image'), { filename: 'bad.txt', contentType: 'text/plain' });

    expect(response.status).toBe(422);
  });

  it('persists selected platform and custom formats', async () => {
    const agent = request.agent(app);
    const { user, token } = await register(agent);
    run('UPDATE users SET credits_balance = 100 WHERE id = ?', [user.id]);
    const bootstrap = await agent.get('/api/bootstrap');
    const format = bootstrap.body.platformFormats.find((item) => item.platform_key === 'facebook');
    const response = await createBannerTask(agent, token, {
      platform_format_ids: [format.id],
      custom_formats: [{ width: 1200, height: 630 }],
    });

    expect(response.status).toBe(201);
    const formats = all('SELECT * FROM task_formats WHERE task_id = ?', [response.body.task_id]);
    expect(formats).toHaveLength(2);
    expect(formats.some((row) => row.platform_format_id === format.id)).toBe(true);
    expect(formats.some((row) => row.custom_width === 1200 && row.custom_height === 630)).toBe(true);
  });

  it('writes ai_cost_logs after FakeAIProvider completes', async () => {
    const agent = request.agent(app);
    const { token } = await register(agent);
    const response = await createBannerTask(agent, token);
    expect(response.status).toBe(201);
    await waitFor(() => get('SELECT status FROM generation_tasks WHERE id = ?', [response.body.task_id])?.status === 'success');

    const log = get('SELECT * FROM ai_cost_logs WHERE task_id = ?', [response.body.task_id]);
    const raw = JSON.parse(log.raw_response_json);
    expect(log.provider).toBe('fake');
    expect(log.model).toBe('fake');
    expect(log.cost_usd).toBe(0);
    expect(raw.latency_ms).toBeGreaterThanOrEqual(0);
  });

  it('make-admin promotes an existing user without duplicating email', async () => {
    const agent = request.agent(app);
    const { user } = await register(agent, 'promote-me@example.com');
    const passwordHash = await bcrypt.hash('new-password123', 10);

    const id = ensureAdmin('promote-me@example.com', passwordHash, 'Promoted Admin');

    expect(id).toBe(user.id);
    expect(get("SELECT COUNT(*) AS count FROM users WHERE email = 'promote-me@example.com'").count).toBe(1);
    expect(get('SELECT role FROM users WHERE id = ?', [user.id]).role).toBe('admin');
  });

  it('seeded quick admin can login with admin / 1234', async () => {
    const agent = request.agent(app);
    const token = await csrf(agent);
    const response = await agent
      .post('/api/auth/login')
      .set('x-csrf-token', token)
      .send({ email: 'admin', password: '1234' });
    expect(response.status).toBe(200);
    expect(response.body.user.email).toBe('admin');
    expect(response.body.user.role).toBe('admin');
  });

  it('dev-pay is restricted to local or admin users', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ad-studio-non-local-test-'));
    app = await createApp({ dbPath: path.join(dir, 'database.sqlite'), isLocal: false });
    const buyer = request.agent(app);
    const admin = request.agent(app);
    const { token: buyerToken } = await register(buyer, 'buyer@example.com');
    const pkg = (await buyer.get('/api/pricing')).body.packages[0];
    const order = await buyer
      .post('/api/orders')
      .set('x-csrf-token', buyerToken)
      .send({ credit_package_id: pkg.id });
    expect(order.status).toBe(201);

    const forbidden = await buyer.post(order.body.dev_pay_url).set('x-csrf-token', buyerToken);
    expect(forbidden.status).toBe(403);

    const adminSession = await register(admin, 'pay-admin@example.com');
    run("UPDATE users SET role = 'admin' WHERE id = ?", [adminSession.user.id]);
    const paid = await admin.post(order.body.dev_pay_url).set('x-csrf-token', adminSession.token);
    expect(paid.status).toBe(200);
    expect(paid.body.order.status).toBe('paid');
  });

  it('covers the demo back-office flow after a successful task', async () => {
    const userAgent = request.agent(app);
    const adminAgent = request.agent(app);
    const { user, token } = await register(userAgent, 'demo-flow@example.com');
    const taskResponse = await createBannerTask(userAgent, token);
    expect(taskResponse.status).toBe(201);
    await waitFor(() => get('SELECT status FROM generation_tasks WHERE id = ?', [taskResponse.body.task_id])?.status === 'success');

    const dashboard = await userAgent.get('/api/dashboard');
    expect(dashboard.status).toBe(200);
    expect(dashboard.body.recentTasks.some((task) => task.id === taskResponse.body.task_id)).toBe(true);

    const tasks = await userAgent.get('/api/my/tasks');
    expect(tasks.body.tasks.some((task) => task.id === taskResponse.body.task_id)).toBe(true);

    const assets = await userAgent.get('/api/assets');
    expect(assets.body.assets.some((asset) => asset.task_id === taskResponse.body.task_id && asset.type === 'input')).toBe(true);
    expect(assets.body.assets.some((asset) => asset.task_id === taskResponse.body.task_id && asset.type === 'output')).toBe(true);

    const credits = await userAgent.get('/api/credits');
    expect(credits.body.transactions.some((tx) => tx.type === 'consume' && tx.related_task_id === taskResponse.body.task_id)).toBe(true);

    const adminSession = await register(adminAgent, 'demo-admin@example.com');
    run("UPDATE users SET role = 'admin' WHERE id = ?", [adminSession.user.id]);

    const users = await adminAgent.get('/api/admin/users?q=demo-flow');
    expect(users.body.users.some((row) => row.id === user.id)).toBe(true);

    const adjust = await adminAgent
      .post(`/api/admin/users/${user.id}/adjust-credits`)
      .set('x-csrf-token', adminSession.token)
      .send({ amount: 20, note: 'demo flow top up' });
    expect(adjust.status).toBe(200);
    expect(adjust.body.user.credits_balance).toBe(config.freeCreditsOnSignup + 20);

    const adminTasks = await adminAgent.get('/api/admin/tasks');
    expect(adminTasks.body.tasks.some((task) => task.id === taskResponse.body.task_id)).toBe(true);
  });

  it('AI_PROVIDER=fake resolves the fake provider', async () => {
    const provider = resolveAIProvider('fake');
    const result = await provider.analyzeProductImages([{ buffer: png, mimetype: 'image/png' }], 'zh-TW');
    expect(provider.providerName).toBe('fake');
    expect(result.imageRoles[0]).toBe('cover');
  });

  it('provider registry lists safe provider metadata and capabilities', async () => {
    const providers = listProviders({
      ...config,
      openaiApiKey: 'sk-secret-value',
      geminiApiKey: 'gemini-secret-value',
      claudeApiKey: '',
      externalAiBaseUrl: 'https://external.test',
      externalAiApiKey: 'external-secret-value',
      devpilotGatewayBaseUrl: 'https://gateway.test',
      devpilotGatewayApiKey: 'gateway-secret-value',
      geminiModel: 'gemini-1.5-flash',
    });
    expect(providers.map((provider) => provider.name)).toEqual(
      expect.arrayContaining(['fake', 'openai', 'gemini', 'claude', 'external', 'devpilot-gateway']),
    );
    expect(providers.find((provider) => provider.name === 'gemini').capabilities).toEqual(
      expect.arrayContaining(['summary', 'classification', 'rewrite', 'extraction', 'planning', 'chat', 'generate', 'image_generation']),
    );
    expect(providers.find((provider) => provider.name === 'openai').capabilities).not.toContain('image_to_video');
    expect(providers.find((provider) => provider.name === 'external').capabilities).toContain('image_to_video');
    const liveMatrix = buildProviderCapabilityMatrix({
      ...config,
      externalAiBaseUrl: 'https://external.test',
      externalAiApiKey: 'external-secret-value',
    });
    const liveExternalVideo = liveMatrix.tools
      .find((tool) => tool.tool_type === 'image_to_video')
      .providers.find((provider) => provider.name === 'external');
    expect(liveExternalVideo.supported).toBe(true);
    expect(liveExternalVideo.live).toBe(true);
    const offlineMatrix = buildProviderCapabilityMatrix({
      ...config,
      externalAiBaseUrl: '',
      externalAiApiKey: '',
    });
    const offlineExternalVideo = offlineMatrix.tools
      .find((tool) => tool.tool_type === 'image_to_video')
      .providers.find((provider) => provider.name === 'external');
    expect(offlineExternalVideo.supported).toBe(true);
    expect(offlineExternalVideo.live).toBe(false);
    const serialized = JSON.stringify(providers);
    expect(serialized).not.toContain('secret-value');
    expect(serialized).not.toContain('apiKey');
    expect(getAvailableCapabilities('claude')).toContain('prompt_rewrite');
  });

  it('provider registry validates config and factory resolves new provider scaffolds', async () => {
    expect(resolveAIProvider('gemini').providerName).toBe('gemini');
    expect(resolveAIProvider('claude').providerName).toBe('claude');
    expect(resolveAIProvider('devpilot-gateway').providerName).toBe('devpilot-gateway');

    const invalidGemini = validateProviderConfig('gemini', { ...config, geminiApiKey: '' });
    expect(invalidGemini.ok).toBe(false);
    expect(invalidGemini.checks[0].message).toContain('not configured');

    const validGeminiPing = await pingProvider('gemini', {}, { ...config, geminiApiKey: 'gemini-secret', geminiModel: 'gemini-1.5-flash' });
    expect(validGeminiPing.ok).toBe(true);
    expect(validGeminiPing.live).toBe(false);
    expect(JSON.stringify(validGeminiPing)).not.toContain('gemini-secret');
  });

  it('rc smoke checklist validates provider matrix guardrails without live AI calls', () => {
    const result = runRcSmokeChecklist({
      env: {
        NODE_ENV: 'development',
        APP_ENV: 'development',
        AI_PROVIDER: 'fake',
        FILESYSTEM_DISK: 'local',
        QUEUE_DRIVER: 'local',
        PORT: '3000',
        APP_URL: 'http://localhost:3000',
        DATABASE_CLIENT: 'sqlite',
        DATABASE_URL: 'sqlite',
      },
      config: {
        ...config,
        nodeEnv: 'development',
        appEnv: 'development',
        aiProvider: 'fake',
        filesystemDisk: 'local',
        queueDriver: 'local',
        databaseClient: 'sqlite',
        databaseUrl: 'sqlite',
      },
    });

    expect(result.ok).toBe(true);
    expect(result.checklist_path).toBe('docs/RC_SMOKE_CHECKLIST.md');
    expect(result.guardrails_path).toBe('docs/PROVIDER_TASK_GUARDRAILS.md');
    expect(result.checks.find((check) => check.key === 'matrix.image_to_video.openai').ok).toBe(true);
    expect(result.checks.find((check) => check.key === 'matrix.image_to_video.fake').ok).toBe(true);
    ['voice_clone', 'lip_sync', 'face_swap', 'avatar_video'].forEach((toolType) => {
      expect(result.checks.find((check) => check.key === `matrix.${toolType}.safety`).ok).toBe(true);
    });
    const output = formatRcSmokeChecklist(result);
    expect(output).toContain('docs/PROVIDER_TASK_GUARDRAILS.md');
    expect(output).toContain('docs/RC_SMOKE_CHECKLIST.md');
    expect(output).toContain('npm run mock:external');
    expect(output).toContain('npm run smoke:external-video');
  });

  it('provider task guardrail docs exist and pin no-fake-success failure codes', () => {
    const agents = fs.readFileSync(path.resolve(config.rootDir, 'AGENTS.md'), 'utf8');
    const guardrailsPath = path.resolve(config.rootDir, 'docs/PROVIDER_TASK_GUARDRAILS.md');
    const guardrails = fs.readFileSync(guardrailsPath, 'utf8');
    expect(fs.existsSync(guardrailsPath)).toBe(true);
    [agents, guardrails].forEach((content) => {
      expect(content).toContain('No Fake Success');
      expect(content).toContain('provider_output_invalid');
      expect(content).toContain('provider_capability_unsupported');
      expect(content).toContain('external_provider_failed');
      expect(content).toContain('consent_required');
    });
  });

  it('release readiness docs and scripts are present', () => {
    const docs = [
      ['docs/RC9_RELEASE_NOTES.md', 'RC9 Release Notes'],
      ['docs/DEPLOYMENT_PRECHECK.md', 'Deployment Precheck'],
      ['docs/ROLLBACK.md', 'Rollback'],
      ['docs/PROVIDER_TASK_GUARDRAILS.md', 'no fake success'],
      ['docs/PROVIDER_TASK_GUARDRAILS.md', 'provider_capability_unsupported'],
      ['docs/PROVIDER_TASK_GUARDRAILS.md', 'external_provider_failed'],
    ];
    docs.forEach(([relativePath, keyword]) => {
      const content = fs.readFileSync(path.resolve(config.rootDir, relativePath), 'utf8');
      expect(content).toContain(keyword);
    });
    const packageJson = JSON.parse(fs.readFileSync(path.resolve(config.rootDir, 'package.json'), 'utf8'));
    ['rc:smoke', 'mock:external', 'smoke:external-video', 'release:check'].forEach((script) => {
      expect(packageJson.scripts[script]).toBeTruthy();
    });
  });

  it('release readiness service validates docs, scripts, env, matrix, and rc smoke without running build/tests', () => {
    const result = runReleaseReadiness({
      env: {
        NODE_ENV: 'development',
        APP_ENV: 'development',
        AI_PROVIDER: 'fake',
        FILESYSTEM_DISK: 'local',
        QUEUE_DRIVER: 'local',
        PORT: '3000',
        APP_URL: 'http://localhost:3000',
        DATABASE_CLIENT: 'sqlite',
        DATABASE_URL: 'sqlite',
      },
      config: {
        ...config,
        nodeEnv: 'development',
        appEnv: 'development',
        aiProvider: 'fake',
        filesystemDisk: 'local',
        queueDriver: 'local',
        databaseClient: 'sqlite',
        databaseUrl: 'sqlite',
      },
    });
    expect(result.ok).toBe(true);
    expect(result.docs.find((doc) => doc.path === 'docs/RC9_RELEASE_NOTES.md').exists).toBe(true);
    expect(result.scripts.find((script) => script.name === 'release:check').exists).toBe(true);
    const output = formatReleaseReadiness(result);
    expect(output).toContain('RC9 release readiness');
    expect(output).toContain('npm test');
    expect(output).toContain('npm run build');
    expect(output).toContain('npm run rc:smoke');
  });

  it('mock external provider response builder supports all image-to-video smoke modes', () => {
    const timestamp = 12345;
    expect(buildMockImageToVideoResponse('success', timestamp)).toMatchObject({
      status: 200,
      body: {
        ok: true,
        video_url: 'https://example.com/mock-video.mp4',
        provider_job_id: 'mock-job-12345',
      },
    });
    expect(buildMockImageToVideoResponse('artifacts', timestamp).body.artifacts[0]).toMatchObject({
      type: 'video',
      url: 'https://example.com/mock-artifact-video.mp4',
      provider_job_id: 'mock-artifact-job-12345',
    });
    expect(buildMockImageToVideoResponse('fail').body.ok).toBe(false);
    expect(buildMockImageToVideoResponse('missing_video')).toMatchObject({
      status: 200,
      body: { ok: true, message: 'ok but no usable video' },
    });
    expect(buildMockImageToVideoResponse('server_error')).toMatchObject({
      status: 500,
      body: { ok: false, error: 'mock server error' },
    });
  });

  it('external video smoke validates mocked success and missing-video flows', async () => {
    const successResponse = buildMockImageToVideoResponse('artifacts', 222);
    const success = await runExternalVideoSmoke({
      baseUrl: 'http://mock-external.test',
      expectedMode: 'artifacts',
      dbPath: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'external-video-smoke-success-')), 'database.sqlite'),
      fetchImpl: async (url, options = {}) => {
        expect(url).toBe('http://mock-external.test/image-to-video');
        const body = JSON.parse(options.body);
        expect(body.tool_type).toBe('image_to_video');
        expect(body.input_images[0].data_url).toMatch(/^data:image\/png;base64,/);
        return jsonResponse(successResponse.body, successResponse.status);
      },
    });
    expect(success.ok).toBe(true);
    expect(success.outcome).toBe('success');
    expect(success.checks.find((check) => check.key === 'artifact.provider').ok).toBe(true);

    const failureResponse = buildMockImageToVideoResponse('missing_video', 333);
    const failure = await runExternalVideoSmoke({
      baseUrl: 'http://mock-external.test',
      expectedMode: 'missing_video',
      dbPath: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'external-video-smoke-fail-')), 'database.sqlite'),
      fetchImpl: async () => jsonResponse(failureResponse.body, failureResponse.status),
    });
    expect(failure.ok).toBe(true);
    expect(failure.outcome).toBe('failed');
    expect(failure.error_code).toBe('external_provider_failed');
    expect(failure.checks.find((check) => check.key === 'credit.refund').ok).toBe(true);
    expect(failure.checks.find((check) => check.key === 'task.no_fake_placeholder').ok).toBe(true);
  });

  it('GeminiProvider analyze parses mocked JSON and redacts inline image data', async () => {
    const previousKey = config.geminiApiKey;
    const previousModel = config.geminiModel;
    config.geminiApiKey = 'gemini-secret';
    config.geminiModel = 'gemini-1.5-flash';
    const fetchImpl = async (_url, options) => {
      expect(options.headers['x-goog-api-key']).toBe('gemini-secret');
      const body = JSON.parse(options.body);
      expect(body.contents[0].parts[1].inline_data.data).toBeTruthy();
      return new Response(JSON.stringify({
        candidates: [{
          content: {
            parts: [{ text: JSON.stringify({
              productName: 'Gemini Product',
              title: 'Gemini Title',
              subtitle: 'Gemini Subtitle',
              customPrompt: 'Gemini clean ad scene',
              imageRoles: ['cover'],
            }) }],
          },
        }],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 8, totalTokenCount: 18 },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    };
    const provider = new GeminiProvider({ fetchImpl });
    const result = await provider.analyzeProductImages([{ buffer: png, mimetype: 'image/png', originalname: 'product.png' }], 'zh-TW');
    expect(result.productName).toBe('Gemini Product');
    expect(result._meta.provider).toBe('gemini');
    expect(JSON.stringify(result._meta.raw_response_json)).not.toContain(png.toString('base64'));
    config.geminiApiKey = previousKey;
    config.geminiModel = previousModel;
  });

  it('ClaudeProvider analyze parses mocked JSON and redacts inline image data', async () => {
    const previousKey = config.claudeApiKey;
    const previousModel = config.claudeModel;
    config.claudeApiKey = 'claude-secret';
    config.claudeModel = 'claude-3-5-haiku-latest';
    const fetchImpl = async (_url, options) => {
      expect(options.headers['x-api-key']).toBe('claude-secret');
      const body = JSON.parse(options.body);
      expect(body.messages[0].content[1].source.data).toBeTruthy();
      return new Response(JSON.stringify({
        content: [{ type: 'text', text: JSON.stringify({
          productName: 'Claude Product',
          title: 'Claude Title',
          subtitle: 'Claude Subtitle',
          customPrompt: 'Claude clean ad scene',
          imageRoles: ['cover'],
        }) }],
        usage: { input_tokens: 10, output_tokens: 8 },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    };
    const provider = new ClaudeProvider({ fetchImpl });
    const result = await provider.analyzeProductImages([{ buffer: png, mimetype: 'image/png', originalname: 'product.png' }], 'zh-TW');
    expect(result.productName).toBe('Claude Product');
    expect(result._meta.provider).toBe('claude');
    expect(JSON.stringify(result._meta.raw_response_json)).not.toContain(png.toString('base64'));
    config.claudeApiKey = previousKey;
    config.claudeModel = previousModel;
  });

  it('prompt render helper replaces supported variables', async () => {
    const rendered = renderTemplateString('Product {{product_name}} in {{language}} for {{formats}}', {
      product_name: 'Coffee',
      language: 'zh-TW',
      formats: ['1080x1080', '1200x628'],
    });
    expect(rendered).toBe('Product Coffee in zh-TW for 1080x1080, 1200x628');
  });

  it('uses fallback prompt when active prompt is missing', async () => {
    run('UPDATE prompt_templates SET is_active = 0 WHERE key = ?', ['banner_generation']);
    const rendered = renderPromptByKey('banner_generation', { product_name: 'Fallback Product' });
    expect(rendered.usedFallback).toBe(true);
    expect(rendered.userPrompt).toContain('Fallback Product');
  });

  it('local storage adapter stores files and blocks traversal paths', async () => {
    const adapter = new LocalStorageAdapter();
    const storagePath = adapter.putUpload({ originalname: 'safe.png', buffer: png }, `test-${Date.now()}.png`);
    expect(adapter.exists(storagePath)).toBe(true);
    expect(adapter.getPublicUrl(storagePath)).toContain('/storage/uploads/');
    expect(() => resolveStoragePath('../secret.txt')).toThrow();
    adapter.delete(storagePath);
    expect(adapter.exists(storagePath)).toBe(false);
  });

  it('storage private paths require owner or admin', async () => {
    const owner = request.agent(app);
    const guest = request.agent(app);
    const { token } = await register(owner, 'storage-owner@example.com');
    const taskResponse = await createBannerTask(owner, token);
    expect(taskResponse.status).toBe(201);
    const image = get('SELECT * FROM task_images WHERE task_id = ? AND type = ?', [taskResponse.body.task_id, 'input']);
    const ownerRead = await owner.get(`/storage/${image.storage_path}`);
    expect(ownerRead.status).toBe(200);

    await register(guest, 'storage-guest@example.com');
    const guestRead = await guest.get(`/storage/${image.storage_path}`);
    expect(guestRead.status).toBe(403);
  });

  it('worker can process pending tasks when QUEUE_DRIVER=worker', async () => {
    const previousDriver = config.queueDriver;
    config.queueDriver = 'worker';
    const agent = request.agent(app);
    const { token } = await register(agent, 'worker-user@example.com');
    const response = await createBannerTask(agent, token);
    expect(response.status).toBe(201);
    expect(get('SELECT status FROM generation_tasks WHERE id = ?', [response.body.task_id]).status).toBe('pending');

    const processed = await queueService.processPendingTasks(5);
    expect(processed).toBeGreaterThanOrEqual(1);
    expect(get('SELECT status FROM generation_tasks WHERE id = ?', [response.body.task_id]).status).toBe('success');
    config.queueDriver = previousDriver;
  });

  it('production missing SESSION_SECRET emits a warning', async () => {
    const originalEnv = config.nodeEnv;
    const originalDefault = config.hasDefaultSessionSecret;
    config.nodeEnv = 'production';
    config.hasDefaultSessionSecret = true;
    const messages = [];
    const warned = warnForProductionConfig({ warn: (message) => messages.push(message) });
    expect(warned).toBe(true);
    expect(messages[0]).toContain('SESSION_SECRET');
    config.nodeEnv = originalEnv;
    config.hasDefaultSessionSecret = originalDefault;
  });

  it('OpenAIProvider analyze parses strict JSON responses', async () => {
    const provider = new OpenAIProvider({
      client: {
        responses: {
          create: async () => ({
            output_text: JSON.stringify({
              productName: 'Ceramic Mug',
              title: 'Morning Starts Here',
              subtitle: 'Warm, simple, everyday',
              customPrompt: 'Bright kitchen counter with soft daylight.',
              imageRoles: ['cover'],
            }),
            usage: { input_tokens: 12, output_tokens: 8 },
          }),
        },
      },
    });

    const result = await provider.analyzeProductImages([{ buffer: png, mimetype: 'image/png' }], 'en');

    expect(result.productName).toBe('Ceramic Mug');
    expect(result.imageRoles).toEqual(['cover']);
    expect(result._meta.provider).toBe('openai');
    expect(result._meta.usage.input_tokens).toBe(12);
  });

  it('OpenAIProvider analyze extracts JSON from prose', async () => {
    const provider = new OpenAIProvider({
      client: {
        responses: {
          create: async () => ({
            output_text:
              'Sure. {"productName":"Serum","title":"Glow Faster","subtitle":"Lightweight daily care","customPrompt":"clean beauty counter","imageRoles":["cover","detail"]}',
          }),
        },
      },
    });

    const result = await provider.analyzeProductImages(
      [
        { buffer: png, mimetype: 'image/png' },
        { buffer: png, mimetype: 'image/png' },
      ],
      'en',
    );

    expect(result.productName).toBe('Serum');
    expect(result.imageRoles).toEqual(['cover', 'detail']);
  });

  it('OpenAIProvider analyze falls back to fake when non-strict provider fails', async () => {
    const previousStrict = config.aiStrictProvider;
    config.aiStrictProvider = false;
    const provider = new OpenAIProvider({
      client: {
        responses: {
          create: async () => {
            throw new Error('OpenAI unavailable');
          },
        },
      },
    });

    const result = await provider.analyzeProductImages([{ buffer: png, mimetype: 'image/png' }], 'en');
    const metadata = provider.consumeLastRunMetadata();

    expect(result.productName).toBe('Smart Product Name');
    expect(metadata.provider).toBe('fake');
    expect(metadata.fallback_from).toBe('openai');
    config.aiStrictProvider = previousStrict;
  });

  it('OpenAIProvider analyze throws when strict provider fails', async () => {
    const previousStrict = config.aiStrictProvider;
    config.aiStrictProvider = true;
    const provider = new OpenAIProvider({
      client: {
        responses: {
          create: async () => {
            throw new Error('OpenAI unavailable');
          },
        },
      },
    });

    await expect(provider.analyzeProductImages([{ buffer: png, mimetype: 'image/png' }], 'en')).rejects.toThrow(
      'OpenAI unavailable',
    );
    config.aiStrictProvider = previousStrict;
  });

  it('OpenAIProvider generateBanner uses task formats and quantity for output count', async () => {
    const previousDriver = config.queueDriver;
    config.queueDriver = 'worker';
    const agent = request.agent(app);
    const { user, token } = await register(agent, 'openai-count@example.com');
    run('UPDATE users SET credits_balance = 200 WHERE id = ?', [user.id]);
    const bootstrap = await agent.get('/api/bootstrap');
    const format = bootstrap.body.platformFormats.find((item) => item.platform_key === 'facebook');
    const response = await createBannerTask(agent, token, {
      platform_format_ids: [format.id],
      custom_formats: [{ width: 1200, height: 630 }],
      quantity: 2,
    });
    expect(response.status).toBe(201);

    const provider = new OpenAIProvider({
      client: {
        images: {
          generate: async () => ({ data: [{ b64_json: png.toString('base64') }] }),
        },
      },
    });

    const outputs = await provider.generateBanner(get('SELECT * FROM generation_tasks WHERE id = ?', [response.body.task_id]));

    expect(outputs).toHaveLength(4);
    expect(outputs.every((output) => output.storage_path.startsWith('outputs/'))).toBe(true);
    config.queueDriver = previousDriver;
  });

  it('OpenAIProvider generateBanner stores base64 images and omits full base64 from raw metadata', async () => {
    const previousDriver = config.queueDriver;
    config.queueDriver = 'worker';
    const agent = request.agent(app);
    const { token } = await register(agent, 'openai-base64@example.com');
    const response = await createBannerTask(agent, token);
    expect(response.status).toBe(201);
    const hugeBase64 = (await makeImage(1024, 1024, '#22c55e')).toString('base64');
    const provider = new OpenAIProvider({
      client: {
        images: {
          generate: async () => ({ data: [{ b64_json: hugeBase64 }] }),
        },
      },
    });

    const outputs = await provider.generateBanner(get('SELECT * FROM generation_tasks WHERE id = ?', [response.body.task_id]));
    const metadata = provider.consumeLastRunMetadata();
    const rawJson = JSON.stringify(metadata.raw_response_json);

    expect(outputs).toHaveLength(1);
    expect(fs.existsSync(resolveStoragePath(outputs[0].storage_path))).toBe(true);
    expect(rawJson).toContain('base64 omitted');
    expect(rawJson).not.toContain(hugeBase64);
    config.queueDriver = previousDriver;
  });

  it('post-processing creates exact target dimensions for common ad formats', async () => {
    const source = await makeImage(1024, 768);
    const formats = [
      { label: 'square', requestedWidth: 1080, requestedHeight: 1080 },
      { label: 'feed', requestedWidth: 1080, requestedHeight: 1350 },
      { label: 'story', requestedWidth: 1080, requestedHeight: 1920 },
      { label: 'wide', requestedWidth: 1920, requestedHeight: 1080 },
      { label: 'facebook', requestedWidth: 1200, requestedHeight: 628 },
    ];

    for (let index = 0; index < formats.length; index += 1) {
      const result = await postProcessImage(source, { taskId: 99, format: formats[index], index });
      const metadata = await sharp(result.buffer).metadata();
      expect(metadata.width).toBe(formats[index].requestedWidth);
      expect(metadata.height).toBe(formats[index].requestedHeight);
      expect(result.mime_type).toBe('image/png');
    }
  });

  it('post-processing output filenames include task, format, and index', () => {
    const format = { label: 'Instagram Feed', requestedWidth: 1080, requestedHeight: 1350 };
    const first = buildOutputFilename({ taskId: 7, format, index: 0 });
    const second = buildOutputFilename({ taskId: 7, format, index: 1 });

    expect(first).toContain('task-7-instagram-feed-1080x1350-0.png');
    expect(second).toContain('task-7-instagram-feed-1080x1350-1.png');
    expect(first).not.toBe(second);
  });

  it('OpenAIProvider generateBanner stores the post-processed target size', async () => {
    const previousDriver = config.queueDriver;
    config.queueDriver = 'worker';
    const agent = request.agent(app);
    const { user, token } = await register(agent, 'openai-postprocess@example.com');
    run('UPDATE users SET credits_balance = 200 WHERE id = ?', [user.id]);
    const response = await createBannerTask(agent, token, {
      platform_format_ids: [],
      custom_formats: [{ width: 1200, height: 628 }],
    });
    expect(response.status).toBe(201);

    const sourceImage = await makeImage(1024, 1024);
    const provider = new OpenAIProvider({
      client: {
        images: {
          generate: async () => ({ data: [{ b64_json: sourceImage.toString('base64') }] }),
        },
      },
    });

    const outputs = await provider.generateBanner(get('SELECT * FROM generation_tasks WHERE id = ?', [response.body.task_id]));
    const storedMetadata = await sharp(resolveStoragePath(outputs[0].storage_path)).metadata();

    expect(outputs[0].width).toBe(1200);
    expect(outputs[0].height).toBe(628);
    expect(storedMetadata.width).toBe(1200);
    expect(storedMetadata.height).toBe(628);
    expect(outputs[0].postprocess.target_width).toBe(1200);
    config.queueDriver = previousDriver;
  });

  it('banner prompt builder varies by aspect ratio and includes quality safeguards', () => {
    const task = {
      product_name: 'Ceramic Mug',
      main_title: 'Morning Starts Here',
      subtitle: 'Warm daily coffee',
      custom_prompt: 'Product analysis: matte white mug with wood handle. data:image/png;base64,AAAAAA',
      text_mode: 'merged',
      language: 'en',
      image_size: '2K',
      style_key: 'minimal',
    };
    const prompts = [
      buildBannerPrompt({ task, promptText: 'Template', format: { label: 'square', requestedWidth: 1080, requestedHeight: 1080 } }),
      buildBannerPrompt({ task, promptText: 'Template', format: { label: 'feed', requestedWidth: 1080, requestedHeight: 1350 } }),
      buildBannerPrompt({ task, promptText: 'Template', format: { label: 'story', requestedWidth: 1080, requestedHeight: 1920 } }),
    ];

    expect(prompts[0]).toContain('1:1 square composition');
    expect(prompts[1]).toContain('4:5 vertical');
    expect(prompts[2]).toContain('9:16 story');
    expect(prompts[0]).toContain('Product analysis summary');
    expect(prompts[0]).toContain('Text safe area');
    expect(prompts[0]).toContain('Preserve the product subject exactly');
    expect(prompts.join('\n')).not.toContain('data:image/png;base64,AAAAAA');
    expect(new Set(prompts).size).toBe(3);
  });

  it('OpenAI fallback fake is recorded with fallback metadata', async () => {
    const previousProvider = config.aiProvider;
    const previousStrict = config.aiStrictProvider;
    const previousKey = config.openaiApiKey;
    config.aiProvider = 'openai';
    config.aiStrictProvider = false;
    config.openaiApiKey = '';
    const agent = request.agent(app);
    const { token } = await register(agent, 'fallback-log@example.com');
    const response = await createBannerTask(agent, token);
    expect(response.status).toBe(201);
    expect(await waitFor(() => get('SELECT status FROM generation_tasks WHERE id = ?', [response.body.task_id])?.status === 'success', 2000)).toBe(true);

    const log = get('SELECT * FROM ai_cost_logs WHERE task_id = ?', [response.body.task_id]);
    const raw = JSON.parse(log.raw_response_json);

    expect(log.provider).toBe('fake');
    expect(raw.fallback_used).toBe(true);
    expect(raw.fallback_reason).toContain('OPENAI_API_KEY');
    expect(raw.latency_ms).toBeGreaterThanOrEqual(0);
    config.aiProvider = previousProvider;
    config.aiStrictProvider = previousStrict;
    config.openaiApiKey = previousKey;
  });

  it('strict provider errors are recorded with error code and message', async () => {
    const previousProvider = config.aiProvider;
    const previousStrict = config.aiStrictProvider;
    const previousKey = config.openaiApiKey;
    config.aiProvider = 'openai';
    config.aiStrictProvider = true;
    config.openaiApiKey = '';
    const agent = request.agent(app);
    const { token } = await register(agent, 'strict-error@example.com');
    const response = await createBannerTask(agent, token);
    expect(response.status).toBe(201);
    expect(await waitFor(() => get('SELECT status FROM generation_tasks WHERE id = ?', [response.body.task_id])?.status === 'failed', 2000)).toBe(true);

    const log = get('SELECT * FROM ai_cost_logs WHERE task_id = ?', [response.body.task_id]);
    const raw = JSON.parse(log.raw_response_json);

    expect(log.provider).toBe('openai');
    expect(raw.error_code).toBeTruthy();
    expect(raw.error_message).toContain('OPENAI_API_KEY');
    expect(raw.latency_ms).toBeGreaterThanOrEqual(0);
    config.aiProvider = previousProvider;
    config.aiStrictProvider = previousStrict;
    config.openaiApiKey = previousKey;
  });

  it('task meta parser exposes fallback badge and failed error text for the frontend', () => {
    const meta = parseTaskCostMeta({
      provider: 'fake',
      model: 'fake',
      image_count: 1,
      cost_usd: 0,
      raw_response_json: JSON.stringify({
        fallback_used: true,
        fallback_reason: 'OpenAI unavailable',
        latency_ms: 123,
        error_code: 'provider_error',
        error_message: 'short failure',
      }),
    });

    expect(meta.fallbackUsed).toBe(true);
    expect(meta.fallbackReason).toBe('OpenAI unavailable');
    expect(meta.errorMessage).toBe('short failure');
    expect(meta.latencyMs).toBe(123);
  });

  it('R2/S3 storage config builder produces expected endpoints', () => {
    const r2 = buildObjectStorageConfig('r2', {
      accountId: 'abc123',
      bucket: 'ad-assets',
      accessKeyId: 'key',
      secretAccessKey: 'secret',
    });
    const s3 = buildObjectStorageConfig('s3', {
      endpoint: 'https://s3.example.com',
      region: 'ap-northeast-1',
      bucket: 'ad-assets',
      accessKeyId: 'key',
      secretAccessKey: 'secret',
    });

    expect(r2.endpoint).toBe('https://abc123.r2.cloudflarestorage.com');
    expect(r2.region).toBe('auto');
    expect(s3.endpoint).toBe('https://s3.example.com');
    expect(s3.region).toBe('ap-northeast-1');
  });

  it('ObjectStorageAdapter can write, check, read, and delete through a mocked S3 client', async () => {
    const calls = [];
    const stored = new Map();
    const client = {
      send: async (command) => {
        calls.push(command.constructor.name);
        const input = command.input;
        if (command.constructor.name === 'PutObjectCommand') {
          stored.set(input.Key, input.Body);
          return {};
        }
        if (command.constructor.name === 'HeadObjectCommand') {
          if (!stored.has(input.Key)) {
            const error = new Error('NotFound');
            error.name = 'NotFound';
            throw error;
          }
          return {};
        }
        if (command.constructor.name === 'GetObjectCommand') {
          return { Body: stored.get(input.Key) };
        }
        if (command.constructor.name === 'DeleteObjectCommand') {
          stored.delete(input.Key);
          return {};
        }
        return {};
      },
    };
    const adapter = new ObjectStorageAdapter('s3', {
      endpoint: 'https://s3.example.com',
      region: 'auto',
      bucket: 'bucket',
      accessKeyId: 'key',
      secretAccessKey: 'secret',
      client,
    });

    const storagePath = await adapter.putOutput(Buffer.from('ok'), 'ad.png');

    expect(storagePath).toBe('outputs/ad.png');
    expect(await adapter.exists(storagePath)).toBe(true);
    expect(await adapter.read(storagePath)).toEqual(Buffer.from('ok'));
    await adapter.delete(storagePath);
    expect(await adapter.exists(storagePath)).toBe(false);
    expect(calls).toEqual([
      'PutObjectCommand',
      'HeadObjectCommand',
      'GetObjectCommand',
      'DeleteObjectCommand',
      'HeadObjectCommand',
    ]);
  });

  it('smoke CLI env parser reads staging options', () => {
    const parsed = parseSmokeEnv({
      SMOKE_BASE_URL: 'https://staging.example.com/',
      SMOKE_EMAIL: 'qa@example.com',
      SMOKE_PASSWORD: 'secret',
      SMOKE_IMAGE_PATH: 'fixture.png',
      SMOKE_TIMEOUT_MS: '1234',
      SMOKE_POLL_INTERVAL_MS: '55',
      SMOKE_EXPECT_PROVIDER: 'openai',
      SMOKE_EXPECT_STORAGE_DISK: 'r2',
    });

    expect(parsed.baseUrl).toBe('https://staging.example.com');
    expect(parsed.email).toBe('qa@example.com');
    expect(parsed.imagePath).toBe('fixture.png');
    expect(parsed.timeoutMs).toBe(1234);
    expect(parsed.pollIntervalMs).toBe(55);
    expect(parsed.expectProvider).toBe('openai');
    expect(parsed.expectStorageDisk).toBe('r2');
  });

  it('smoke test reports timeout diagnostics', async () => {
    const fetchImpl = async (url) => {
      const pathName = new URL(url).pathname;
      if (pathName === '/api/session') return jsonResponse({ csrfToken: 'csrf' }, 200, { 'set-cookie': 'sid=1' });
      if (pathName === '/api/auth/register') return jsonResponse({ user: { email: 'smoke@example.com' } });
      if (pathName === '/api/bootstrap') return jsonResponse({ platformFormats: [{ id: 1, platform_key: 'facebook' }] });
      if (pathName === '/studio/analyze') return jsonResponse({ productName: 'P', title: 'T', subtitle: 'S', customPrompt: 'C' });
      if (pathName === '/studio/tasks') return jsonResponse({ task_id: 77 });
      if (pathName === '/api/tasks/77') return jsonResponse({ task: { id: 77, status: 'pending', ai_cost_logs: [] } });
      return jsonResponse({}, 404);
    };

    await expect(
      runSmokeTest({ baseUrl: 'https://staging.example.com', timeoutMs: 5, pollIntervalMs: 1 }, { fetchImpl }),
    ).rejects.toMatchObject({ step: 'poll task', taskId: 77 });
  });

  it('smoke test formats failed task diagnostics', async () => {
    const fetchImpl = async (url) => {
      const pathName = new URL(url).pathname;
      if (pathName === '/api/session') return jsonResponse({ csrfToken: 'csrf' }, 200, { 'set-cookie': 'sid=1' });
      if (pathName === '/api/auth/register') return jsonResponse({ user: { email: 'smoke@example.com' } });
      if (pathName === '/api/bootstrap') return jsonResponse({ platformFormats: [{ id: 1, platform_key: 'facebook' }] });
      if (pathName === '/studio/analyze') return jsonResponse({ productName: 'P', title: 'T', subtitle: 'S', customPrompt: 'C' });
      if (pathName === '/studio/tasks') return jsonResponse({ task_id: 88 });
      if (pathName === '/api/tasks/88') {
        return jsonResponse({
          task: {
            id: 88,
            status: 'failed',
            error_message: 'provider failed',
            ai_cost_logs: [
              {
                provider: 'openai',
                model: 'gpt-image-1',
                image_count: 1,
                raw_response_json: JSON.stringify({ error_code: 'provider_error', error_message: 'provider failed' }),
              },
            ],
          },
        });
      }
      return jsonResponse({}, 404);
    };

    try {
      await runSmokeTest({ baseUrl: 'https://staging.example.com', timeoutMs: 50, pollIntervalMs: 1 }, { fetchImpl });
      throw new Error('expected smoke failure');
    } catch (error) {
      const formatted = formatSmokeError(error);
      expect(formatted).toContain('failed step: verify completed/failed');
      expect(formatted).toContain('task id: 88');
      expect(formatted).toContain('provider failed');
    }
  });

  it('smoke output URL reachable check supports success and diagnostics', async () => {
    const ok = await verifyOutputUrls(['https://cdn.example.com/a.png'], {
      fetchImpl: async () => textResponse('ok', 200),
    });
    expect(ok[0].ok).toBe(true);

    await expect(
      verifyOutputUrls(['https://cdn.example.com/missing.png'], {
        fetchImpl: async () => textResponse('missing', 403),
      }),
    ).rejects.toMatchObject({ step: 'verify output urls', status: 403 });
  });

  it('storage check passes for local storage and cleans up its test file', async () => {
    const adapter = new LocalStorageAdapter();
    const result = await runStorageCheck({
      config: { filesystemDisk: 'local', storagePublicUrl: '', s3: {}, r2: {} },
      storage: adapter,
      checkPublicUrl: false,
    });

    expect(result.ok).toBe(true);
    expect(adapter.exists(result.storagePath)).toBe(false);
  });

  it('storage check passes with mocked R2 config and client', async () => {
    const stored = new Map();
    const client = {
      send: async (command) => {
        const input = command.input;
        if (command.constructor.name === 'PutObjectCommand') {
          stored.set(input.Key, input.Body);
          return {};
        }
        if (command.constructor.name === 'HeadObjectCommand') {
          if (!stored.has(input.Key)) {
            const error = new Error('NotFound');
            error.name = 'NotFound';
            throw error;
          }
          return {};
        }
        if (command.constructor.name === 'GetObjectCommand') return { Body: stored.get(input.Key) };
        if (command.constructor.name === 'DeleteObjectCommand') {
          stored.delete(input.Key);
          return {};
        }
        return {};
      },
    };
    const configForCheck = {
      filesystemDisk: 'r2',
      storagePublicUrl: '',
      s3: {},
      r2: { accountId: 'abc123', bucket: 'bucket', accessKeyId: 'key', secretAccessKey: 'secret' },
    };
    const adapter = new ObjectStorageAdapter('r2', {
      accountId: 'abc123',
      bucket: 'bucket',
      accessKeyId: 'key',
      secretAccessKey: 'secret',
      client,
    });

    const result = await runStorageCheck({ config: configForCheck, storage: adapter, checkPublicUrl: false });

    expect(result.ok).toBe(true);
    expect(result.objectConfig.endpoint).toBe('https://abc123.r2.cloudflarestorage.com');
    expect(stored.size).toBe(0);
  });

  it('storage check returns clear public URL and missing env errors', async () => {
    const fakeStorage = {
      async putOutput() {
        return 'outputs/test.txt';
      },
      async exists() {
        return true;
      },
      async read() {
        return Buffer.from('ad-studio-storage-check');
      },
      getPublicUrl() {
        return 'https://cdn.example.com/outputs/test.txt';
      },
      async delete() {},
    };
    const publicResult = await runStorageCheck({
      config: { filesystemDisk: 'local', storagePublicUrl: 'https://cdn.example.com', s3: {}, r2: {} },
      storage: fakeStorage,
      fetchImpl: async () => textResponse('forbidden', 403),
    });
    const missingResult = await runStorageCheck({
      config: { filesystemDisk: 'r2', storagePublicUrl: '', s3: {}, r2: {} },
      storage: fakeStorage,
      checkPublicUrl: false,
    });

    expect(publicResult.ok).toBe(false);
    expect(publicResult.errors[0]).toContain('Public URL GET failed');
    expect(formatStorageCheck(publicResult)).toContain('STORAGE_PUBLIC_URL');
    expect(missingResult.ok).toBe(false);
    expect(missingResult.errors.join(' ')).toContain('R2_ACCOUNT_ID');
    const missingPublicUrl = await runStorageCheck({
      config: { filesystemDisk: 'r2', storagePublicUrl: '', s3: {}, r2: { accountId: 'abc', bucket: 'bucket', accessKeyId: 'key', secretAccessKey: 'secret' } },
      storage: fakeStorage,
      checkPublicUrl: true,
    });
    expect(missingPublicUrl.ok).toBe(false);
    expect(missingPublicUrl.errors.join(' ')).toContain('STORAGE_PUBLIC_URL');
  });

  it('OpenAI auto image mode uses reference edit when input exists', async () => {
    const previousDriver = config.queueDriver;
    const previousMode = config.openaiImageMode;
    config.queueDriver = 'worker';
    config.openaiImageMode = 'auto';
    const agent = request.agent(app);
    const { token } = await register(agent, 'openai-edit@example.com');
    const response = await createBannerTask(agent, token);
    expect(response.status).toBe(201);
    let editCalled = false;
    const sourceImage = await makeImage(1024, 1024);
    const provider = new OpenAIProvider({
      client: {
        images: {
          edit: async () => {
            editCalled = true;
            return { data: [{ b64_json: sourceImage.toString('base64') }] };
          },
          generate: async () => {
            throw new Error('generate should not be called');
          },
        },
      },
    });

    const outputs = await provider.generateBanner(get('SELECT * FROM generation_tasks WHERE id = ?', [response.body.task_id]));
    const metadata = provider.consumeLastRunMetadata();

    expect(editCalled).toBe(true);
    expect(outputs[0].width).toBe(1200);
    expect(metadata.image_mode).toBe('edit');
    expect(metadata.used_reference_image).toBe(true);
    config.queueDriver = previousDriver;
    config.openaiImageMode = previousMode;
  });

  it('OpenAI edit failure falls back to prompt generation when non-strict', async () => {
    const previousDriver = config.queueDriver;
    const previousMode = config.openaiImageMode;
    const previousStrict = config.aiStrictProvider;
    config.queueDriver = 'worker';
    config.openaiImageMode = 'auto';
    config.aiStrictProvider = false;
    const agent = request.agent(app);
    const { token } = await register(agent, 'openai-edit-fallback@example.com');
    const response = await createBannerTask(agent, token);
    expect(response.status).toBe(201);
    const sourceImage = await makeImage(1024, 1024);
    const provider = new OpenAIProvider({
      client: {
        images: {
          edit: async () => {
            throw new Error('edit unsupported');
          },
          generate: async () => ({ data: [{ b64_json: sourceImage.toString('base64') }] }),
        },
      },
    });

    const outputs = await provider.generateBanner(get('SELECT * FROM generation_tasks WHERE id = ?', [response.body.task_id]));
    const metadata = provider.consumeLastRunMetadata();

    expect(outputs[0].postprocess.target_width).toBe(1200);
    expect(metadata.image_mode).toBe('generate');
    expect(metadata.used_reference_image).toBe(false);
    expect(metadata.fallback_reason).toContain('reference edit failed');
    config.queueDriver = previousDriver;
    config.openaiImageMode = previousMode;
    config.aiStrictProvider = previousStrict;
  });

  it('OpenAI edit failure throws when strict provider is enabled', async () => {
    const previousDriver = config.queueDriver;
    const previousMode = config.openaiImageMode;
    const previousStrict = config.aiStrictProvider;
    config.queueDriver = 'worker';
    config.openaiImageMode = 'auto';
    config.aiStrictProvider = true;
    const agent = request.agent(app);
    const { token } = await register(agent, 'openai-edit-strict@example.com');
    const response = await createBannerTask(agent, token);
    expect(response.status).toBe(201);
    const provider = new OpenAIProvider({
      client: {
        images: {
          edit: async () => {
            throw new Error('edit unsupported');
          },
          generate: async () => ({ data: [{ b64_json: png.toString('base64') }] }),
        },
      },
    });

    await expect(provider.generateBanner(get('SELECT * FROM generation_tasks WHERE id = ?', [response.body.task_id]))).rejects.toThrow(
      'edit unsupported',
    );
    config.queueDriver = previousDriver;
    config.openaiImageMode = previousMode;
    config.aiStrictProvider = previousStrict;
  });

  it('OpenAIProvider cutout uses transparent-background image edit', async () => {
    const previousDriver = config.queueDriver;
    config.queueDriver = 'worker';
    const agent = request.agent(app);
    const { token } = await register(agent, 'openai-cutout@example.com');
    const response = await agent
      .post('/studio/tasks')
      .set('x-csrf-token', token)
      .field('tool_type', 'cutout')
      .field('product_name', 'Snack Pack')
      .attach('images', png, { filename: 'product.png', contentType: 'image/png' });
    expect(response.status).toBe(201);
    expect(get('SELECT requested_capability FROM generation_tasks WHERE id = ?', [response.body.task_id]).requested_capability).toBe(
      'image_editing',
    );

    const sourceImage = await makeTransparentCutoutImage(256, 256);
    let editPayload = null;
    const provider = new OpenAIProvider({
      client: {
        images: {
          edit: async (payload) => {
            editPayload = payload;
            return {
              data: [{ b64_json: sourceImage.toString('base64') }],
              usage: { input_tokens: 3, output_tokens: 0, total_tokens: 3 },
            };
          },
        },
      },
    });

    const outputs = await provider.cutoutImage(get('SELECT * FROM generation_tasks WHERE id = ?', [response.body.task_id]));
    const metadata = provider.consumeLastRunMetadata();

    expect(editPayload.background).toBe('transparent');
    expect(editPayload.output_format).toBe('png');
    expect(editPayload.input_fidelity).toBe('high');
    expect(outputs[0].mime_type).toBe('image/png');
    expect(outputs[0].postprocess.transparent_background).toBe(true);
    expect(outputs[0].postprocess.cutout_validation.output.transparent_pixel_ratio).toBeGreaterThanOrEqual(0.01);
    expect(fs.existsSync(resolveStoragePath(outputs[0].storage_path))).toBe(true);
    expect(metadata.provider).toBe('openai');
    expect(metadata.image_mode).toBe('edit_cutout');
    expect(metadata.requested_background).toBe('transparent');
    config.queueDriver = previousDriver;
  });

  it('OpenAIProvider cutout rejects opaque PNG output without fake fallback', async () => {
    const previousDriver = config.queueDriver;
    config.queueDriver = 'worker';
    const agent = request.agent(app);
    const { token } = await register(agent, 'openai-cutout-opaque@example.com');
    const response = await agent
      .post('/studio/tasks')
      .set('x-csrf-token', token)
      .field('tool_type', 'cutout')
      .field('product_name', 'Opaque Snack Pack')
      .attach('images', png, { filename: 'product.png', contentType: 'image/png' });
    expect(response.status).toBe(201);

    const opaqueImage = await makeImage(256, 256, '#22c55e');
    let fallbackCalled = false;
    const provider = new OpenAIProvider({
      client: {
        images: {
          edit: async () => ({
            data: [{ b64_json: opaqueImage.toString('base64') }],
            usage: { input_tokens: 3, output_tokens: 0, total_tokens: 3 },
          }),
        },
      },
      fallbackProvider: {
        cutoutImage: async () => {
          fallbackCalled = true;
          return [];
        },
      },
    });

    await expect(provider.cutoutImage(get('SELECT * FROM generation_tasks WHERE id = ?', [response.body.task_id]))).rejects.toMatchObject({
      code: 'provider_output_invalid',
      retryable: false,
      message: '智慧去背未產生透明背景，請換一張主體更清楚、背景更單純的圖片後再試。',
    });
    expect(fallbackCalled).toBe(false);
    expect(all('SELECT * FROM task_images WHERE task_id = ? AND type = ?', [response.body.task_id, 'output'])).toHaveLength(0);
    config.queueDriver = previousDriver;
  });

  it('task metadata parser handles missing fields and exposes debug fields', () => {
    const empty = parseTaskCostMeta();
    const meta = parseTaskCostMeta({
      provider: 'openai',
      model: 'gpt-image-1',
      image_count: 2,
      raw_response_json: JSON.stringify({
        fallback_reason: 'reference edit failed',
        image_mode: 'generate',
        used_reference_image: true,
        storage_disk: 'r2',
        error_code: 'provider_error',
        error_message: 'short error',
      }),
    });

    expect(empty.fallbackUsed).toBe(false);
    expect(meta.fallbackReason).toBe('reference edit failed');
    expect(meta.imageMode).toBe('generate');
    expect(meta.usedReferenceImage).toBe(true);
    expect(meta.storageDisk).toBe('r2');
    expect(meta.errorCode).toBe('provider_error');
    expect(imageLoadErrorMessage()).toContain('storage public URL');
  });

  it('friendlyTaskError converts provider safety rejections to user-friendly Chinese', () => {
    const meta = parseTaskCostMeta({
      provider: 'openai',
      model: 'gpt-image-1',
      raw_response_json: JSON.stringify({
        error_code: 'moderation_blocked',
        error_message:
          '400 Your request was rejected by the safety system. The request was rejected as a result of our safety system.',
      }),
    });

    expect(friendlyTaskError(meta)).toBe(
      '圖片被供應商安全系統拒絕處理，未產生結果，點數已退回。請換一張較清楚、無敏感人物/角色/商標疑慮的商品圖後再試。',
    );
  });

  it('friendlyTaskError keeps normal provider errors on the shortTaskError path', () => {
    const meta = parseTaskCostMeta({
      provider: 'openai',
      model: 'gpt-image-1',
      raw_response_json: JSON.stringify({
        error_code: 'provider_timeout',
        error_message: 'Provider timed out while generating output.',
      }),
    });

    expect(friendlyTaskError(meta, 'fallback error')).toBe(shortTaskError(meta, 'fallback error'));
    expect(friendlyTaskError(meta, 'fallback error')).toBe('Provider timed out while generating output.');
  });

  it('friendlyTaskError shows cutout output validation guidance', () => {
    const meta = parseTaskCostMeta({
      provider: 'openai',
      model: 'gpt-image-1',
      raw_response_json: JSON.stringify({
        error_code: 'provider_output_invalid',
        error_message: 'opaque output',
      }),
    });

    expect(friendlyTaskError(meta)).toBe('智慧去背未產生透明背景，請換一張主體更清楚、背景更單純的圖片後再試。');
  });

  it('friendlyTaskError shows image-to-video provider capability guidance', () => {
    const meta = parseTaskCostMeta({
      provider: 'openai',
      model: 'gpt-image-1',
      raw_response_json: JSON.stringify({
        error_code: 'provider_capability_unsupported',
        error_message:
          '目前尚未設定可用的圖生影片供應商，未產生影片，點數已退回。請到後台設定支援 image_to_video 的供應商後再試。',
      }),
    });

    expect(friendlyTaskError(meta)).toBe(
      '目前尚未設定可用的圖生影片供應商，未產生影片，點數已退回。請到後台設定支援圖生影片的供應商後再試。',
    );
  });

  it('friendlyTaskError shows external image-to-video provider failure guidance', () => {
    const meta = parseTaskCostMeta({
      provider: 'external',
      model: 'external',
      raw_response_json: JSON.stringify({
        error_code: 'external_provider_failed',
        error_message: '外部圖生影片供應商未回傳可用影片，未產生結果，點數已退回。',
      }),
    });

    expect(friendlyTaskError(meta)).toBe(
      '外部圖生影片供應商未回傳可用影片，未產生結果，點數已退回。請稍後再試或通知管理員檢查供應商設定。',
    );
  });

  it('admin routes require admin and task list tolerates missing metadata', async () => {
    const userAgent = request.agent(app);
    await register(userAgent, 'plain-admin-denied@example.com');
    expect((await userAgent.get('/api/admin/summary')).status).toBe(403);

    const adminAgent = request.agent(app);
    const adminSession = await register(adminAgent, 'phase6-admin@example.com');
    run('UPDATE users SET role = ? WHERE id = ?', ['admin', adminSession.user.id]);
    const taskId = insert(
      `INSERT INTO generation_tasks (user_id, tool_type, status, language, image_size, logo_mode, quantity, credits_cost, failure_refunded, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [adminSession.user.id, 'banner', 'pending', 'zh-TW', '2K', 'keep', 1, 0, 0, new Date().toISOString(), new Date().toISOString()],
    );

    const response = await adminAgent.get('/api/admin/tasks?q=phase6-admin');
    expect(response.status).toBe(200);
    expect(response.body.tasks.some((task) => task.id === taskId)).toBe(true);
    expect(response.body.tasks.find((task) => task.id === taskId).provider).toBeNull();
  });

  it('admin summary counts fallback tasks and redacts raw base64', async () => {
    const adminAgent = request.agent(app);
    const adminSession = await register(adminAgent, 'phase6-redact@example.com');
    run('UPDATE users SET role = ? WHERE id = ?', ['admin', adminSession.user.id]);
    const nowIso = new Date().toISOString();
    const taskId = insert(
      `INSERT INTO generation_tasks (user_id, tool_type, status, language, image_size, logo_mode, quantity, credits_cost, failure_refunded, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [adminSession.user.id, 'banner', 'success', 'zh-TW', '2K', 'keep', 1, 0, 0, nowIso, nowIso],
    );
    insert(
      `INSERT INTO ai_cost_logs (task_id, provider, model, image_count, cost_usd, raw_response_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        taskId,
        'fake',
        'fake',
        1,
        0,
        JSON.stringify({ fallback_used: true, b64_json: 'a'.repeat(400), latency_ms: 12 }),
        nowIso,
        nowIso,
      ],
    );

    const summary = await adminAgent.get('/api/admin/summary');
    expect(summary.status).toBe(200);
    expect(summary.body.stats.todayFallbacks).toBeGreaterThanOrEqual(1);
    const detail = getAdminTaskDetail(taskId);
    expect(JSON.stringify(detail.ai_cost_logs[0].raw_response_json_safe)).toContain('[redacted_base64]');
    expect(JSON.stringify(safeRawResponse(JSON.stringify({ image: 'a'.repeat(400) })))).toContain('[redacted_base64]');
  });

  it('admin failed task view exposes concise error fields and user search paginates', async () => {
    const adminAgent = request.agent(app);
    const adminSession = await register(adminAgent, 'phase6-failed@example.com');
    run('UPDATE users SET role = ? WHERE id = ?', ['admin', adminSession.user.id]);
    await register(request.agent(app), 'phase6-search-one@example.com');
    await register(request.agent(app), 'phase6-search-two@example.com');
    const nowIso = new Date().toISOString();
    const taskId = insert(
      `INSERT INTO generation_tasks (user_id, tool_type, status, language, image_size, logo_mode, quantity, credits_cost, failure_refunded, error_message, last_error_code, last_error_message, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [adminSession.user.id, 'banner', 'failed', 'zh-TW', '2K', 'keep', 1, 0, 0, 'provider down', 'provider_error', 'provider down', nowIso, nowIso],
    );

    const failed = await adminAgent.get('/api/admin/tasks/failed');
    expect(failed.status).toBe(200);
    expect(failed.body.tasks.find((task) => task.id === taskId).error_code).toBe('provider_error');
    const users = await adminAgent.get('/api/admin/users?q=phase6-search&limit=1');
    expect(users.status).toBe(200);
    expect(users.body.users.length).toBe(1);
    expect(users.body.total).toBeGreaterThanOrEqual(2);
  });

  it('env diagnostics cover local pass and production blockers', () => {
    expect(runEnvDiagnostics({ NODE_ENV: 'development', AI_PROVIDER: 'fake', FILESYSTEM_DISK: 'local', QUEUE_DRIVER: 'local', SESSION_SECRET: 'dev-secret', PORT: '3000', APP_URL: 'http://localhost:3000', DB_DATABASE: ':memory:' }).ok).toBe(true);
    expect(runEnvDiagnostics({ NODE_ENV: 'production', APP_ENV: 'production', AUTH_BYPASS: 'true', SESSION_SECRET: 'strong-secret', AI_PROVIDER: 'openai', OPENAI_API_KEY: 'sk-test', FILESYSTEM_DISK: 'local', QUEUE_DRIVER: 'worker', PORT: '3000', APP_URL: 'https://app.test', DATABASE_URL: 'sqlite' }).ok).toBe(false);
    expect(runEnvDiagnostics({ NODE_ENV: 'production', APP_ENV: 'production', SESSION_SECRET: 'strong-secret', AI_PROVIDER: 'fake', FILESYSTEM_DISK: 'local', QUEUE_DRIVER: 'worker', PORT: '3000', APP_URL: 'https://app.test', DATABASE_URL: 'sqlite' }).ok).toBe(false);
    expect(runEnvDiagnostics({ NODE_ENV: 'production', APP_ENV: 'production', SESSION_SECRET: 'strong-secret', AI_PROVIDER: 'fake', ALLOW_FAKE_PROVIDER: 'true', ALLOW_SQLITE_IN_PRODUCTION: 'true', FILESYSTEM_DISK: 'local', QUEUE_DRIVER: 'local', PORT: '3000', APP_URL: 'https://app.test', DATABASE_URL: 'sqlite' }).ok).toBe(true);
    expect(runEnvDiagnostics({ NODE_ENV: 'production', APP_ENV: 'production', SESSION_SECRET: 'strong-secret', AI_PROVIDER: 'openai', OPENAI_API_KEY: '', FILESYSTEM_DISK: 'local', QUEUE_DRIVER: 'worker', PORT: '3000', APP_URL: 'https://app.test', DATABASE_URL: 'sqlite' }).checks.some((check) => check.key === 'OPENAI_API_KEY' && check.level === 'FAIL')).toBe(true);
    expect(runEnvDiagnostics({ AI_PROVIDER: 'gemini', GEMINI_API_KEY: '', FILESYSTEM_DISK: 'local', QUEUE_DRIVER: 'local', PORT: '3000', APP_URL: 'http://localhost:3000', DB_DATABASE: ':memory:' }).checks.some((check) => check.key === 'GEMINI_API_KEY' && check.level === 'FAIL')).toBe(true);
    expect(runEnvDiagnostics({ AI_PROVIDER: 'claude', ANTHROPIC_API_KEY: '', FILESYSTEM_DISK: 'local', QUEUE_DRIVER: 'local', PORT: '3000', APP_URL: 'http://localhost:3000', DB_DATABASE: ':memory:' }).checks.some((check) => check.key === 'ANTHROPIC_API_KEY' && check.level === 'FAIL')).toBe(true);
    expect(runEnvDiagnostics({ AI_PROVIDER: 'devpilot-gateway', DEVPILOT_GATEWAY_BASE_URL: '', FILESYSTEM_DISK: 'local', QUEUE_DRIVER: 'local', PORT: '3000', APP_URL: 'http://localhost:3000', DB_DATABASE: ':memory:' }).checks.some((check) => check.key === 'DEVPILOT_GATEWAY_BASE_URL' && check.level === 'FAIL')).toBe(true);
    expect(runEnvDiagnostics({ FILESYSTEM_DISK: 'r2', R2_ACCOUNT_ID: 'acct', R2_ACCESS_KEY_ID: 'key', R2_SECRET_ACCESS_KEY: 'secret' }).ok).toBe(false);
    expect(runEnvDiagnostics({ FILESYSTEM_DISK: 's3', S3_REGION: 'auto', S3_BUCKET: 'bucket', S3_ACCESS_KEY_ID: 'key', S3_SECRET_ACCESS_KEY: 'secret' }).ok).toBe(false);
    expect(runEnvDiagnostics({ NODE_ENV: 'production', APP_ENV: 'production', SESSION_SECRET: 'strong-secret', AI_PROVIDER: 'openai', OPENAI_API_KEY: 'sk-test', AI_STRICT_PROVIDER: 'false', FILESYSTEM_DISK: 'local', QUEUE_DRIVER: 'worker', PORT: '3000', APP_URL: 'https://app.test', DATABASE_URL: 'sqlite' }).checks.some((check) => check.key === 'AI_STRICT_PROVIDER' && check.level === 'WARN')).toBe(true);
  });

  it('env check CLI exits non-zero on failures', () => {
    const result = spawnSync(process.execPath, ['server/cli/env-check.js'], {
      cwd: process.cwd(),
      env: { ...process.env, NODE_ENV: 'production', APP_ENV: 'production', SESSION_SECRET: '', AI_PROVIDER: 'openai', FILESYSTEM_DISK: 'local', QUEUE_DRIVER: 'worker' },
      encoding: 'utf8',
    });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('FAIL');
  });

  it('smoke and storage diagnostics can write JSON reports', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ad-studio-report-'));
    const smokeReport = path.join(dir, 'nested', 'smoke.json');
    const fetchImpl = async (url) => {
      const pathName = new URL(url).pathname;
      if (pathName === '/api/session') return jsonResponse({ csrfToken: 'csrf' }, 200, { 'set-cookie': 'sid=1' });
      if (pathName === '/api/auth/register') return jsonResponse({ user: { email: 'smoke@example.com' } });
      if (pathName === '/api/bootstrap') return jsonResponse({ platformFormats: [{ id: 1, platform_key: 'facebook' }] });
      if (pathName === '/studio/analyze') return jsonResponse({ productName: 'P', title: 'T', subtitle: 'S', customPrompt: 'C' });
      if (pathName === '/studio/tasks') return jsonResponse({ task_id: 99 });
      if (pathName === '/api/tasks/99') {
        return jsonResponse({ task: { id: 99, status: 'success', ai_cost_logs: [{ provider: 'fake', model: 'fake', image_count: 1, cost_usd: 0, raw_response_json: JSON.stringify({ storage_disk: 'local', latency_ms: 10, fallback_used: true, fallback_reason: 'OpenAI failed with sk-testsecret123 and ' + 'a'.repeat(300) }) }], output_images: [{ url: '/storage/out.png' }] } });
      }
      if (pathName === '/storage/out.png') return textResponse('png');
      return jsonResponse({}, 404);
    };
    await runSmokeTest({ baseUrl: 'https://staging.example.com', timeoutMs: 50, pollIntervalMs: 1, reportPath: smokeReport }, { fetchImpl });
    const smokeJson = JSON.parse(fs.readFileSync(smokeReport, 'utf8'));
    expect(smokeJson.task_id).toBe(99);
    expect(smokeJson.status).toBe('success');
    expect(smokeJson.fallback_used).toBe(true);
    expect(smokeJson.fallback_reason).toContain('[redacted_api_key]');
    expect(smokeJson.fallback_reason).toContain('[redacted_base64]');
    expect(JSON.stringify(smokeJson)).not.toContain('sk-testsecret123');

    const storageReport = path.join(dir, 'storage', 'report.json');
    const fakeStorage = {
      putOutput: async () => 'outputs/check.txt',
      exists: async () => true,
      read: async () => Buffer.from('ad-studio-storage-check'),
      delete: async () => {},
      getPublicUrl: () => 'https://cdn.example.com/outputs/check.txt',
    };
    const storage = await runStorageCheck({
      config: { filesystemDisk: 'local', storagePublicUrl: '', r2: {}, s3: {} },
      storage: fakeStorage,
      checkPublicUrl: false,
      reportPath: storageReport,
    });
    expect(storage.ok).toBe(true);
    const storageJson = JSON.parse(fs.readFileSync(storageReport, 'utf8'));
    expect(JSON.stringify(storageJson)).not.toContain('secret');
    expect(storageJson.write_ok).toBe(true);
    expect(storageJson).toHaveProperty('delete_ok');
  });

  it('storage public URL failure report includes actionable suggestions and redacts secrets', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ad-studio-storage-public-'));
    const reportPath = path.join(dir, 'storage-public.json');
    const fakeStorage = {
      putOutput: async () => 'outputs/check.txt',
      exists: async () => true,
      read: async () => Buffer.from('ad-studio-storage-check'),
      delete: async () => {},
      getPublicUrl: () => 'https://assets.example.com/outputs/check.txt?token=sk-secretvalue1234567890',
    };
    const result = await runStorageCheck({
      config: { filesystemDisk: 'r2', storagePublicUrl: 'https://assets.example.com', r2: { accountId: 'abc', bucket: 'bucket', accessKeyId: 'key', secretAccessKey: 'secret' }, s3: {} },
      storage: fakeStorage,
      fetchImpl: async () => textResponse('forbidden', 403),
      reportPath,
    });
    expect(result.ok).toBe(false);
    const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    expect(report.public_url_ok).toBe(false);
    expect(report.suggestions.join(' ')).toContain('bucket permission');
    expect(report.suggestions.join(' ')).toContain('STORAGE_PUBLIC_URL');
    expect(report.suggestions.join(' ')).toContain('CORS');
    expect(JSON.stringify(report)).not.toContain('sk-secretvalue1234567890');
    expect(JSON.stringify(report)).not.toContain('secret');
  });

  it('storage check CLI handles missing R2 env without stack trace', () => {
    const result = spawnSync(process.execPath, ['server/cli/storage-check.js'], {
      cwd: process.cwd(),
      env: { ...process.env, FILESYSTEM_DISK: 'r2', R2_ACCOUNT_ID: '', R2_BUCKET: '', R2_ACCESS_KEY_ID: '', R2_SECRET_ACCESS_KEY: '' },
      encoding: 'utf8',
    });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('R2_ACCOUNT_ID is required');
    expect(`${result.stdout}\n${result.stderr}`).not.toContain('at ObjectStorageAdapter');
  });

  it('smoke health check failure writes failed step and suggestions', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ad-studio-smoke-health-'));
    const reportPath = path.join(dir, 'smoke-health.json');
    await expect(
      runSmokeTest(
        { baseUrl: 'https://staging.example.com', reportPath, timeoutMs: 5, pollIntervalMs: 1 },
        { fetchImpl: async () => { throw new Error('connect refused'); } },
      ),
    ).rejects.toMatchObject({ step: 'health check' });
    const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    expect(report.failed_step).toBe('health check');
    expect(report.suggestions.join(' ')).toContain('SMOKE_BASE_URL');
  });

  it('smoke failed reports still include failed_step', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ad-studio-smoke-fail-'));
    const reportPath = path.join(dir, 'smoke-failed.json');
    const fetchImpl = async (url) => {
      const pathName = new URL(url).pathname;
      if (pathName === '/api/session') return jsonResponse({ csrfToken: 'csrf' }, 200, { 'set-cookie': 'sid=1' });
      return jsonResponse({ message: 'boom' }, 500);
    };
    await expect(runSmokeTest({ baseUrl: 'https://staging.example.com', reportPath, timeoutMs: 5, pollIntervalMs: 1 }, { fetchImpl })).rejects.toMatchObject({ step: 'login' });
    const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    expect(report.failed_step).toBe('login');
  });

  it('quality review creates markdown and handles missing outputs', async () => {
    const agent = request.agent(app);
    const session = await register(agent, 'quality@example.com');
    const taskId = insert(
      `INSERT INTO generation_tasks (user_id, tool_type, status, product_name, main_title, language, image_size, logo_mode, quantity, credits_cost, failure_refunded, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [session.user.id, 'banner', 'success', 'Quality Product', 'Quality Title', 'zh-TW', '2K', 'keep', 1, 0, 0, new Date().toISOString(), new Date().toISOString()],
    );
    const outputPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'quality-review-')), 'review.md');
    const result = await runQualityReview({ QUALITY_TASK_IDS: String(taskId), QUALITY_REVIEW_PATH: outputPath });
    expect(result.markdown).toContain(`Task #${taskId}`);
    expect(result.markdown).toContain('_No output images_');
    expect(fs.existsSync(outputPath)).toBe(true);
  });

  it('task failure policy increments retry count and stops retrying validation errors', async () => {
    const previousDriver = config.queueDriver;
    config.queueDriver = 'worker';
    const agent = request.agent(app);
    const { token } = await register(agent, 'retry-policy@example.com');
    const retryable = await createBannerTask(agent, token, { custom_prompt: '__RETRYABLE_FAIL__' });
    await GenerateTaskJob.handle(retryable.body.task_id);
    let task = get('SELECT * FROM generation_tasks WHERE id = ?', [retryable.body.task_id]);
    expect(task.status).toBe('pending');
    expect(task.retry_count).toBe(1);
    run('UPDATE generation_tasks SET retry_count = max_retries WHERE id = ?', [retryable.body.task_id]);
    await GenerateTaskJob.handle(retryable.body.task_id);
    task = get('SELECT * FROM generation_tasks WHERE id = ?', [retryable.body.task_id]);
    expect(task.status).toBe('failed');
    expect(task.last_error_code).toBe('storage_error');

    const validation = await createBannerTask(agent, token, { custom_prompt: '__FAKE_FAIL__' });
    await GenerateTaskJob.handle(validation.body.task_id);
    const validationTask = get('SELECT * FROM generation_tasks WHERE id = ?', [validation.body.task_id]);
    expect(validationTask.status).toBe('failed');
    expect(validationTask.retry_count).toBe(0);
    expect(classifyTaskError({ code: 'storage_error', message: 'R2 timeout' }).retryable).toBe(true);
    expect(classifyTaskError({ code: 'provider_capability_unsupported', message: 'No video provider.' }).retryable).toBe(false);
    expect(classifyTaskError({ code: 'external_provider_failed', message: 'No video artifact.' }).retryable).toBe(false);
    config.queueDriver = previousDriver;
  });

  it('provider_output_invalid is final, refunded, and not retried', async () => {
    const previousDriver = config.queueDriver;
    const previousFakeCost = config.fakeTaskCost;
    const previousRefund = config.refundOnFailure;
    config.queueDriver = 'worker';
    config.fakeTaskCost = 5;
    config.refundOnFailure = true;
    const agent = request.agent(app);
    const { user, token } = await register(agent, 'provider-output-invalid@example.com');
    const response = await agent
      .post('/studio/tasks')
      .set('x-csrf-token', token)
      .field('tool_type', 'cutout')
      .field('product_name', 'Refund Snack Pack')
      .attach('images', png, { filename: 'product.png', contentType: 'image/png' });
    expect(response.status).toBe(201);
    expect(get('SELECT credits_balance FROM users WHERE id = ?', [user.id]).credits_balance).toBe(config.freeCreditsOnSignup - 5);

    const error = new Error('智慧去背未產生透明背景，請換一張主體更清楚、背景更單純的圖片後再試。');
    error.code = 'provider_output_invalid';
    error.retryable = false;
    expect(classifyTaskError(error).retryable).toBe(false);

    recordTaskFailure(get('SELECT * FROM generation_tasks WHERE id = ?', [response.body.task_id]), error);
    const task = get('SELECT * FROM generation_tasks WHERE id = ?', [response.body.task_id]);
    const refund = get('SELECT * FROM credit_transactions WHERE related_task_id = ? AND type = ?', [response.body.task_id, 'refund']);

    expect(task.status).toBe('failed');
    expect(task.retry_count).toBe(0);
    expect(task.last_error_code).toBe('provider_output_invalid');
    expect(task.failure_refunded).toBe(1);
    expect(refund.amount).toBe(5);
    expect(get('SELECT credits_balance FROM users WHERE id = ?', [user.id]).credits_balance).toBe(config.freeCreditsOnSignup);
    config.queueDriver = previousDriver;
    config.fakeTaskCost = previousFakeCost;
    config.refundOnFailure = previousRefund;
  });

  it('tasks:recover dry run and requeue mutate only when requested', async () => {
    const agent = request.agent(app);
    const session = await register(agent, 'recover@example.com');
    const oldIso = new Date(Date.now() - 60 * 60_000).toISOString();
    const taskId = insert(
      `INSERT INTO generation_tasks (user_id, tool_type, status, language, image_size, logo_mode, quantity, credits_cost, failure_refunded, processing_started_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [session.user.id, 'banner', 'processing', 'zh-TW', '2K', 'keep', 1, 0, 0, oldIso, oldIso, oldIso],
    );
    const dry = recoverStuckTasks({ afterMinutes: 15, dryRun: true, action: 'requeue' });
    expect(dry.tasks.some((task) => task.id === taskId)).toBe(true);
    expect(get('SELECT status FROM generation_tasks WHERE id = ?', [taskId]).status).toBe('processing');
    recoverStuckTasks({ afterMinutes: 15, dryRun: false, action: 'requeue' });
    expect(get('SELECT status FROM generation_tasks WHERE id = ?', [taskId]).status).toBe('pending');
  });

  it('admin retry requires admin privileges', async () => {
    const userAgent = request.agent(app);
    const userSession = await register(userAgent, 'retry-denied@example.com');
    const taskId = insert(
      `INSERT INTO generation_tasks (user_id, tool_type, status, language, image_size, logo_mode, quantity, credits_cost, failure_refunded, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [userSession.user.id, 'banner', 'failed', 'zh-TW', '2K', 'keep', 1, 0, 0, new Date().toISOString(), new Date().toISOString()],
    );
    const userCsrf = await csrf(userAgent);
    expect((await userAgent.post(`/api/admin/tasks/${taskId}/retry`).set('x-csrf-token', userCsrf).send({})).status).toBe(403);

    const adminAgent = request.agent(app);
    const adminSession = await register(adminAgent, 'retry-admin@example.com');
    run('UPDATE users SET role = ? WHERE id = ?', ['admin', adminSession.user.id]);
    const adminCsrf = await csrf(adminAgent);
    const response = await adminAgent.post(`/api/admin/tasks/${taskId}/retry`).set('x-csrf-token', adminCsrf).send({});
    expect(response.status).toBe(200);
    expect(response.body.task.status).toBe('pending');
  });

  it('security and empty state APIs stay safe for production UX', async () => {
    const agent = request.agent(app);
    await register(agent, 'empty-state@example.com');
    expect((await agent.get('/api/assets')).status).toBe(200);
    expect((await agent.get('/api/credits')).status).toBe(200);
    config.openaiApiKey = 'sk-never-render-this';
    const bootstrap = await agent.get('/api/bootstrap');
    expect(JSON.stringify(bootstrap.body)).not.toContain('sk-never-render-this');

    const token = await csrf(agent);
    const invalid = await agent
      .post('/studio/analyze')
      .set('x-csrf-token', token)
      .attach('images', Buffer.from('bad'), { filename: 'bad.txt', contentType: 'text/plain' });
    expect(invalid.status).toBe(422);
    const tooLarge = await agent
      .post('/studio/analyze')
      .set('x-csrf-token', token)
      .attach('images', Buffer.alloc(10 * 1024 * 1024 + 1), { filename: 'huge.png', contentType: 'image/png' });
    expect(tooLarge.status).toBe(422);
  });

  it('registration can be disabled without blocking existing admin tools', async () => {
    const previous = config.registrationEnabled;
    config.registrationEnabled = false;
    const agent = request.agent(app);
    const token = await csrf(agent);
    const response = await agent
      .post('/api/auth/register')
      .set('x-csrf-token', token)
      .send({ name: 'Closed', email: 'closed@example.com', password: 'password123', terms: true });
    expect(response.status).toBe(403);
    config.registrationEnabled = previous;
  });

  it('health endpoints expose version and redact config details', async () => {
    const health = await request(app).get('/health');
    expect(health.status).toBe(200);
    expect(health.body.version).toBe(config.appVersion);
    const deep = await request(app).get('/health/deep');
    expect(deep.status).toBe(200);
    expect(JSON.stringify(deep.body)).not.toContain(config.openaiApiKey || 'sk-');
    expect(deep.body.checks.provider.name).toBeDefined();
  });

  it('admin storage, system, provider, and quality endpoints require admin and stay redacted', async () => {
    const userAgent = request.agent(app);
    await register(userAgent, 'storage-user@example.com');
    expect((await userAgent.get('/api/admin/storage')).status).toBe(403);
    expect((await userAgent.get('/api/admin/providers')).status).toBe(403);
    expect((await userAgent.get('/api/admin/provider-capability-matrix')).status).toBe(403);

    const adminAgent = request.agent(app);
    const adminSession = await register(adminAgent, 'storage-admin@example.com');
    run('UPDATE users SET role = ? WHERE id = ?', ['admin', adminSession.user.id]);
    const previousR2Secret = config.r2.secretAccessKey;
    config.r2.secretAccessKey = 'super-secret-token';
    const storage = await adminAgent.get('/api/admin/storage');
    expect(storage.status).toBe(200);
    expect(adminStorageSummary().disk).toBe(config.filesystemDisk);
    expect(JSON.stringify(storage.body)).not.toContain('super-secret-token');
    config.r2.secretAccessKey = previousR2Secret;

    const system = await adminAgent.get('/api/admin/system');
    expect(system.status).toBe(200);
    expect(system.body.version).toBe(config.appVersion);
    expect(system.body.providers.map((provider) => provider.name)).toContain('gemini');

    const providers = await adminAgent.get('/api/admin/providers');
    expect(providers.status).toBe(200);
    expect(providers.body.providers.map((provider) => provider.name)).toEqual(expect.arrayContaining(['fake', 'openai', 'gemini', 'claude', 'devpilot-gateway']));
    expect(JSON.stringify(providers.body)).not.toContain(config.openaiApiKey || 'sk-');

    const matrix = await adminAgent.get('/api/admin/provider-capability-matrix');
    expect(matrix.status).toBe(200);
    const imageToVideo = matrix.body.tools.find((tool) => tool.tool_type === 'image_to_video');
    expect(imageToVideo.required_capability).toBe('image_to_video');
    expect(imageToVideo.providers.find((provider) => provider.name === 'openai').supported).toBe(false);
    expect(imageToVideo.providers.find((provider) => provider.name === 'openai').live).toBe(false);
    const fakeVideo = imageToVideo.providers.find((provider) => provider.name === 'fake');
    expect(fakeVideo.supported).toBe(true);
    expect(fakeVideo.live).toBe(false);
    expect(fakeVideo.fake_only).toBe(true);
    expect(imageToVideo.providers.find((provider) => provider.name === 'external').supported).toBe(true);
    expect(imageToVideo.providers.find((provider) => provider.name === 'devpilot-gateway').supported).toBe(true);
    ['voice_clone', 'lip_sync', 'face_swap', 'avatar_video'].forEach((toolType) => {
      const sensitive = matrix.body.tools.find((tool) => tool.tool_type === toolType);
      expect(sensitive.consent_required).toBe(true);
      expect(sensitive.private_by_default).toBe(true);
    });
    expect(matrix.body.tools.find((tool) => tool.tool_type === 'copywriting').required_capability).toBe('generate');

    const ping = await adminAgent.post('/api/admin/providers/fake/ping').set('x-csrf-token', adminSession.token).send({});
    expect(ping.status).toBe(200);
    expect(ping.body.ok).toBe(true);

    const quality = await adminAgent.get('/api/admin/quality');
    expect(quality.status).toBe(200);
    expect(Array.isArray(quality.body.recentTasks)).toBe(true);
  });

  it('quality review saves admin notes and markdown includes saved review', async () => {
    const adminAgent = request.agent(app);
    const adminSession = await register(adminAgent, 'quality-admin@example.com');
    run('UPDATE users SET role = ? WHERE id = ?', ['admin', adminSession.user.id]);
    const token = await csrf(adminAgent);
    const task = await createBannerTask(adminAgent, token);
    await waitFor(() => get('SELECT status FROM generation_tasks WHERE id = ?', [task.body.task_id])?.status === 'success');
    const review = await adminAgent
      .post('/api/admin/quality')
      .set('x-csrf-token', token)
      .send({ task_id: task.body.task_id, product_preserved: 'pass', no_garbled_text: 'pass', commercial_quality: 5, notes: 'looks good' });
    expect(review.status).toBe(200);
    const result = await runQualityReview({ QUALITY_TASK_IDS: String(task.body.task_id) });
    expect(result.markdown).toContain('looks good');
  });

  it('Gemini and Claude text providers normalize mocked execution safely', async () => {
    const previousGeminiKey = config.geminiApiKey;
    const previousGeminiModel = config.geminiModel;
    const previousClaudeKey = config.claudeApiKey;
    const previousClaudeModel = config.claudeModel;
    config.geminiApiKey = '';
    const missingGemini = await new GeminiProvider().generateText({ prompt: 'hello' });
    expect(missingGemini.ok).toBe(false);
    expect(missingGemini.retryable).toBe(false);

    let geminiRequest;
    config.geminiApiKey = 'gemini-secret-never-leak';
    config.geminiModel = 'gemini-1.5-flash';
    const gemini = new GeminiProvider({
      fetchImpl: async (_url, options) => {
        geminiRequest = JSON.parse(options.body);
        return jsonResponse({
          candidates: [{ content: { parts: [{ text: 'GEMINI_OK' }] } }],
          usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 2, totalTokenCount: 5 },
        });
      },
    });
    const geminiOk = await gemini.generateText({ prompt: 'ping gemini', model: 'gemini-1.5-flash' });
    expect(geminiOk).toMatchObject({ ok: true, provider: 'gemini', output: 'GEMINI_OK' });
    expect(geminiRequest.contents[0].parts[0].text).toBe('ping gemini');
    expect(geminiOk.usage.total_tokens).toBe(5);

    const gemini403 = await new GeminiProvider({
      fetchImpl: async () => jsonResponse({ error: { message: 'bad gemini-secret-never-leak', status: 'PERMISSION_DENIED' } }, 403),
    }).generateText({ prompt: 'deny' });
    expect(gemini403.retryable).toBe(false);
    expect(JSON.stringify(gemini403)).not.toContain('gemini-secret-never-leak');
    const gemini429 = await new GeminiProvider({ fetchImpl: async () => jsonResponse({ error: { message: 'slow down' } }, 429) }).generateText({ prompt: 'rate' });
    expect(gemini429.retryable).toBe(true);
    const gemini500 = await new GeminiProvider({ fetchImpl: async () => jsonResponse({ error: { message: 'server' } }, 500) }).generateText({ prompt: 'server' });
    expect(gemini500.retryable).toBe(true);
    const geminiTimeout = await new GeminiProvider({ fetchImpl: async () => { const error = new Error('timeout'); error.name = 'AbortError'; throw error; } }).generateText({ prompt: 'timeout' });
    expect(geminiTimeout.retryable).toBe(true);

    config.claudeApiKey = '';
    const missingClaude = await new ClaudeProvider().generateText({ prompt: 'hello' });
    expect(missingClaude.ok).toBe(false);
    expect(missingClaude.retryable).toBe(false);

    let claudeRequest;
    config.claudeApiKey = 'claude-secret-never-leak';
    config.claudeModel = 'claude-3-5-haiku-latest';
    const claudeOk = await new ClaudeProvider({
      fetchImpl: async (_url, options) => {
        claudeRequest = JSON.parse(options.body);
        return jsonResponse({
          content: [{ text: 'CLAUDE_OK' }],
          usage: { input_tokens: 4, output_tokens: 2 },
        });
      },
    }).generateText({ prompt: 'ping claude', model: 'claude-3-5-haiku-latest' });
    expect(claudeOk).toMatchObject({ ok: true, provider: 'claude', output: 'CLAUDE_OK' });
    expect(claudeRequest.messages[0].content[0].text).toBe('ping claude');
    expect(claudeOk.usage.total_tokens).toBe(6);

    const claude403 = await new ClaudeProvider({
      fetchImpl: async () => jsonResponse({ error: { message: 'bad claude-secret-never-leak', type: 'permission_error' } }, 403),
    }).generateText({ prompt: 'deny' });
    expect(claude403.retryable).toBe(false);
    expect(JSON.stringify(claude403)).not.toContain('claude-secret-never-leak');
    const claude429 = await new ClaudeProvider({ fetchImpl: async () => jsonResponse({ error: { message: 'rate' } }, 429) }).generateText({ prompt: 'rate' });
    expect(claude429.retryable).toBe(true);
    const claude500 = await new ClaudeProvider({ fetchImpl: async () => jsonResponse({ error: { message: 'server' } }, 500) }).generateText({ prompt: 'server' });
    expect(claude500.retryable).toBe(true);
    const claudeTimeout = await new ClaudeProvider({ fetchImpl: async () => { const error = new Error('timeout'); error.name = 'AbortError'; throw error; } }).generateText({ prompt: 'timeout' });
    expect(claudeTimeout.retryable).toBe(true);

    const livePing = await pingProvider('gemini', { live: true, fetchImpl: async () => jsonResponse({ candidates: [{ content: { parts: [{ text: 'GEMINI_OK' }] } }] }) });
    expect(livePing.ok).toBe(true);

    config.geminiApiKey = previousGeminiKey;
    config.geminiModel = previousGeminiModel;
    config.claudeApiKey = previousClaudeKey;
    config.claudeModel = previousClaudeModel;
  });

  it('provider selection, asset metadata, quality flags, and audit APIs stay safe', async () => {
    const agent = request.agent(app);
    const { token } = await register(agent, 'provider-selection@example.com');
    const fallback = await createBannerTask(agent, token, {
      provider: 'gemini',
      model: 'gemini-1.5-flash',
      capability: 'image_generation',
      quality_review_required: true,
    });
    expect(fallback.status).toBe(201);
    await waitFor(() => get('SELECT status FROM generation_tasks WHERE id = ?', [fallback.body.task_id])?.status === 'success');
    const task = get('SELECT * FROM generation_tasks WHERE id = ?', [fallback.body.task_id]);
    expect(task.requested_provider).toBe('gemini');
    expect(task.resolved_provider).toBe('fake');
    expect(task.provider_selection_reason).toContain('fallback');
    expect(task.quality_review_required).toBe(1);

    const strict = await createBannerTask(agent, token, { provider: 'gemini', strict_provider: true });
    expect(strict.status).toBe(422);

    const assets = await agent.get('/api/assets?type=output');
    const asset = assets.body.assets.find((item) => item.task_id === fallback.body.task_id);
    expect(asset).toBeTruthy();
    const metadata = await agent
      .post(`/api/assets/${asset.id}/metadata`)
      .set('x-csrf-token', token)
      .send({ favorite: true, tags: 'hero,approved', notes: 'demo note' });
    expect(metadata.status).toBe(200);
    expect(listAssets({ user: { id: task.user_id }, query: { type: 'output', q: String(task.id) } }).assets[0].favorite).toBe(true);
    const manifest = await agent.get(`/api/assets/export-manifest?ids=${asset.id}`);
    expect(manifest.status).toBe(200);
    expect(JSON.stringify(manifest.body)).not.toContain('secret');

    const adminAgent = request.agent(app);
    const adminSession = await register(adminAgent, 'provider-selection-admin@example.com');
    run('UPDATE users SET role = ? WHERE id = ?', ['admin', adminSession.user.id]);
    const review = await adminAgent
      .post('/api/admin/quality')
      .set('x-csrf-token', adminSession.token)
      .send({ task_id: fallback.body.task_id, approved: false, needs_regeneration: true, regeneration_reason: 'needs sharper logo', notes: 'reviewed' });
    expect(review.status).toBe(200);
    const detail = await agent.get(`/api/tasks/${fallback.body.task_id}`);
    expect(detail.body.task.quality_reviews[0].needs_regeneration).toBe(1);
    const quality = await runQualityReview({ QUALITY_TASK_IDS: String(fallback.body.task_id) });
    expect(quality.markdown).toContain('needs_regeneration');

    const audit = await adminAgent.get('/api/admin/audit');
    expect(audit.status).toBe(200);
    expect(audit.body.logs.some((log) => log.action === 'asset_metadata_update')).toBe(true);
    expect(JSON.stringify(audit.body)).not.toContain('secret');
    const usage = await adminAgent.get('/api/admin/usage');
    expect(usage.status).toBe(200);
    expect(usage.body.tasksByProvider.fake).toBeGreaterThanOrEqual(1);
  });

  it('external API rate limit is per source and rc:local report is redacted', async () => {
    resetExternalApiRateLimits();
    const previousKeys = config.devpilotExternalApiKeysRaw;
    const previousEnabled = config.externalApiRateLimitEnabled;
    const previousMax = config.externalApiRateLimitMax;
    const previousWindow = config.externalApiRateLimitWindowMs;
    config.devpilotExternalApiKeysRaw = 'source-a:key-a';
    config.externalApiRateLimitEnabled = true;
    config.externalApiRateLimitMax = 1;
    config.externalApiRateLimitWindowMs = 60_000;

    const first = await request(app).get('/api/external/ai-handoffs').set('X-DevPilot-Source-System', 'source-a').set('X-DevPilot-Api-Key', 'key-a');
    expect(first.status).toBe(200);
    const second = await request(app).get('/api/external/ai-handoffs').set('X-DevPilot-Source-System', 'source-a').set('X-DevPilot-Api-Key', 'key-a');
    expect(second.status).toBe(429);
    expect(JSON.stringify(second.body)).not.toContain('key-a');
    const logs = listAuditLogs({ action: 'external_api_rate_limited' }).logs;
    expect(logs.length).toBeGreaterThan(0);
    expect(JSON.stringify(logs)).not.toContain('key-a');

    const report = await runRcLocalDiagnostics({
      reportPath: path.join(os.tmpdir(), `rc-local-${Date.now()}.json`),
      storageCheck: async () => ({ ok: true, disk: 'local', checks: {}, errors: [] }),
      fetchImpl: async () => jsonResponse({ ok: true, secret: 'should-be-redacted', openaiApiKey: 'sk-report-secret' }),
    });
    expect(report.ok).toBe(true);
    expect(JSON.stringify(report)).not.toContain('sk-report-secret');
    expect(JSON.stringify(report)).toContain('[redacted]');

    config.devpilotExternalApiKeysRaw = previousKeys;
    config.externalApiRateLimitEnabled = previousEnabled;
    config.externalApiRateLimitMax = previousMax;
    config.externalApiRateLimitWindowMs = previousWindow;
    resetExternalApiRateLimits();
  });

  it('ai:ping normalizes live provider diagnostics and writes redacted reports', async () => {
    const reportPath = path.join(os.tmpdir(), `ai-ping-${Date.now()}.json`);
    const missingOpenAi = await runAiPing({
      env: { AI_PING_PROVIDER: 'openai', OPENAI_API_KEY: '', AI_PING_REPORT_PATH: path.join(os.tmpdir(), `ai-ping-missing-${Date.now()}.json`) },
    });
    expect(missingOpenAi.ok).toBe(false);
    expect(missingOpenAi.skipped).toBe(true);
    expect(missingOpenAi.diagnosis.code).toBe('missing_api_key');

    const geminiOk = await runAiPing({
      env: {
        AI_PING_PROVIDER: 'gemini',
        GEMINI_API_KEY: 'gemini-live-secret',
        AI_PING_MODEL: 'gemini-1.5-flash',
        AI_PING_PROMPT: 'ping',
        AI_PING_REPORT_PATH: reportPath,
      },
      fetchImpl: async () => jsonResponse({
        candidates: [{ content: { parts: [{ text: 'GEMINI_OK' }] } }],
        usageMetadata: { promptTokenCount: 2, candidatesTokenCount: 1, totalTokenCount: 3 },
      }),
    });
    expect(geminiOk).toMatchObject({ ok: true, provider: 'gemini', output: 'GEMINI_OK' });
    expect(geminiOk.usage.total_tokens).toBe(3);
    const written = fs.readFileSync(reportPath, 'utf8');
    expect(written).not.toContain('gemini-live-secret');

    const gemini403 = await runAiPing({
      env: { AI_PING_PROVIDER: 'gemini', GEMINI_API_KEY: 'gemini-live-secret', AI_PING_REPORT_PATH: path.join(os.tmpdir(), `ai-ping-403-${Date.now()}.json`) },
      fetchImpl: async () => jsonResponse({ error: { message: 'bad gemini-live-secret', status: 'PERMISSION_DENIED' } }, 403),
    });
    expect(gemini403.ok).toBe(false);
    expect(gemini403.diagnosis.code).toBe('credential_rejected');
    expect(JSON.stringify(gemini403)).not.toContain('gemini-live-secret');

    const gemini429 = await runAiPing({
      env: { AI_PING_PROVIDER: 'gemini', GEMINI_API_KEY: 'gemini-live-secret' },
      fetchImpl: async () => jsonResponse({ error: { message: 'quota exceeded' } }, 429),
    });
    expect(gemini429.diagnosis.code).toBe('quota_or_rate_limit');
    expect(gemini429.retryable).toBe(true);

    const claude500 = await runAiPing({
      env: { AI_PING_PROVIDER: 'claude', ANTHROPIC_API_KEY: 'claude-live-secret' },
      fetchImpl: async () => jsonResponse({ error: { message: 'upstream down' } }, 500),
    });
    expect(claude500.diagnosis.code).toBe('provider_server_error');
    expect(claude500.retryable).toBe(true);
    expect(JSON.stringify(claude500)).not.toContain('claude-live-secret');

    const timeout = await runAiPing({
      env: { AI_PING_PROVIDER: 'gemini', GEMINI_API_KEY: 'gemini-live-secret' },
      fetchImpl: async () => { const error = new Error('timeout'); error.name = 'AbortError'; throw error; },
    });
    expect(timeout.diagnosis.code).toBe('timeout_or_network_retryable');
    expect(timeout.retryable).toBe(true);

    const fake = await runAiPing({ env: { AI_PING_PROVIDER: 'fake', AI_PING_PROMPT: 'hello' } });
    expect(fake.ok).toBe(true);
    const last = await readAiPingLastReport();
    expect(last.provider).toBe('fake');

    const adminAgent = request.agent(app);
    const adminSession = await register(adminAgent, 'ai-ping-admin@example.com');
    run('UPDATE users SET role = ? WHERE id = ?', ['admin', adminSession.user.id]);
    const providers = await adminAgent.get('/api/admin/providers');
    expect(providers.status).toBe(200);
    expect(providers.body.lastPing.provider).toBe('fake');
    expect(JSON.stringify(providers.body)).not.toContain('gemini-live-secret');
    expect(JSON.stringify(providers.body)).not.toContain('claude-live-secret');
  });

  it('maintenance tools are guarded and export safe demo data', async () => {
    await fs.promises.mkdir(path.join(config.rootDir, 'tmp'), { recursive: true });
    const tmpFile = path.join(config.rootDir, 'tmp', `cleanup-${Date.now()}.txt`);
    await fs.promises.writeFile(tmpFile, 'remove me');
    const cleanup = await runLocalCleanup({ CLEANUP_TMP: 'true', CLEANUP_DRY_RUN: 'true' });
    expect(cleanup.dryRun).toBe(true);
    expect(fs.existsSync(tmpFile)).toBe(true);

    const exported = await exportDemoData({ DEMO_EXPORT_PATH: `tmp/demo-export-${Date.now()}.json` });
    const json = fs.readFileSync(exported.outputPath, 'utf8');
    expect(json).not.toContain('password123');
    expect(json).not.toContain('iVBORw0KGgoAAAANS');

    await expect(runDevReset({ NODE_ENV: 'production', APP_ENV: 'production' })).rejects.toThrow(/blocked/);
  });

  it('Docker deployment files are present and ignore unsafe local artifacts', () => {
    expect(fs.existsSync(path.join(config.rootDir, 'Dockerfile'))).toBe(true);
    expect(fs.readFileSync(path.join(config.rootDir, 'docker-compose.yml'), 'utf8')).toContain('worker');
    const dockerignore = fs.readFileSync(path.join(config.rootDir, '.dockerignore'), 'utf8');
    expect(dockerignore).toContain('node_modules');
    expect(dockerignore).toContain('.env');
    expect(dockerignore).toContain('server/storage');
  });

  it('admin integration toolbox exposes allowlisted instructions download safely', async () => {
    const adminAgent = request.agent(app);
    const adminSession = await register(adminAgent, 'integration-toolbox-admin@example.com');
    run('UPDATE users SET role = ? WHERE id = ?', ['admin', adminSession.user.id]);

    const list = await adminAgent.get('/api/admin/integration-toolbox');
    expect(list.status).toBe(200);
    expect(list.body.resources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          resource_id: 'external-project-admin-integration-instructions',
          display_name: 'External Project Admin Integration Instructions',
          download_filename: 'external_project_admin_integration_instructions.md',
        }),
      ]),
    );

    const download = await adminAgent.get('/admin/integration-toolbox/download/external-project-admin-integration-instructions');
    expect(download.status).toBe(200);
    expect(download.headers['content-disposition']).toContain('external_project_admin_integration_instructions.md');
    expect(download.text).toContain('External Project Admin Integration Instructions');
    expect(download.text).toContain('DEVPILOT_API_KEY=replace-with-devpilot-external-api-key');
    expect(download.text).toContain('https://your-devpilot-domain.example');
    expect(download.text).not.toContain('dp_ext_');
    expect(download.text).not.toContain('sk-');
    expect(download.text).not.toContain('AIza');
    expect(download.text).not.toContain('ANTHROPIC_API_KEY=');
    expect(download.text).not.toContain('OPENAI_API_KEY=');
    expect(download.text).not.toContain('GEMINI_API_KEY=');
    expect(download.text).not.toContain('CLAUDE_API_KEY=');

    const unknown = await adminAgent.get('/admin/integration-toolbox/download/unknown-resource');
    expect(unknown.status).toBe(404);

    const traversal = await adminAgent.get('/admin/integration-toolbox/download/%2e%2e%2f.env');
    expect(traversal.status).toBe(404);
  });

  it('admin can save DevPilot external API keys without exposing raw key', async () => {
    const previousKeys = config.devpilotExternalApiKeysRaw;
    config.devpilotExternalApiKeysRaw = '';
    const rawKey = 'dp_ext_test_key_that_should_never_echo_1234567890';
    const adminAgent = request.agent(app);
    const adminSession = await register(adminAgent, 'devpilot-key-admin@example.com');
    run('UPDATE users SET role = ? WHERE id = ?', ['admin', adminSession.user.id]);

    const userAgent = request.agent(app);
    const userSession = await register(userAgent, 'devpilot-key-user@example.com');
    const forbidden = await userAgent
      .post('/api/admin/devpilot-keys')
      .set('x-csrf-token', userSession.token)
      .send({ source_system: 'ad-studio-ai', api_key: rawKey });
    expect(forbidden.status).toBe(403);

    const save = await adminAgent
      .post('/api/admin/devpilot-keys')
      .set('x-csrf-token', adminSession.token)
      .send({ source_system: 'ad-studio-ai', label: 'AD Studio AI', api_key: rawKey });
    expect(save.status).toBe(200);
    expect(save.body.key).toMatchObject({
      source_system: 'ad-studio-ai',
      label: 'AD Studio AI',
      status: 'active',
    });
    expect(JSON.stringify(save.body)).not.toContain(rawKey);
    expect(save.body.key.key_hash).toBeUndefined();

    const stored = get('SELECT * FROM devpilot_external_api_keys WHERE source_system = ?', ['ad-studio-ai']);
    expect(stored.key_hash).toBe(hashDevPilotApiKey(rawKey));
    expect(stored.key_hash).not.toContain(rawKey);

    const list = await adminAgent.get('/api/admin/devpilot-keys');
    expect(list.status).toBe(200);
    expect(JSON.stringify(list.body)).not.toContain(rawKey);
    expect(JSON.stringify(list.body)).not.toContain(stored.key_hash);

    const owner = await register(request.agent(app), 'devpilot-key-task-owner@example.com');
    const timestamp = new Date().toISOString();
    const taskId = insert(
      `INSERT INTO generation_tasks (user_id, tool_type, status, product_name, language, image_size, logo_mode, quantity, credits_cost, failure_refunded, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [owner.user.id, 'banner', 'pending', 'DB Key Product', 'zh-TW', '2K', 'keep', 1, 0, 0, timestamp, timestamp],
    );
    const handoff = await request(app)
      .post(`/api/external/tasks/${taskId}/handoffs`)
      .set('X-DevPilot-Source-System', 'ad-studio-ai')
      .set('X-DevPilot-Api-Key', rawKey)
      .send({
        from_agent: 'ad-studio-ai',
        to_agent: 'devpilot-reviewer',
        reason: 'Manual review',
        next_step: 'Review',
        risk: 'low',
      });
    expect(handoff.status).toBe(201);
    expect(handoff.body.ok).toBe(true);
    expect(JSON.stringify(handoff.body)).not.toContain(rawKey);

    const revoke = await adminAgent
      .post(`/api/admin/devpilot-keys/${save.body.key.id}/revoke`)
      .set('x-csrf-token', adminSession.token)
      .send({});
    expect(revoke.status).toBe(200);
    expect(revoke.body.key.status).toBe('revoked');

    const afterRevoke = await request(app)
      .get('/api/external/ai-handoffs')
      .set('X-DevPilot-Source-System', 'ad-studio-ai')
      .set('X-DevPilot-Api-Key', rawKey);
    expect(afterRevoke.status).toBe(403);
    config.devpilotExternalApiKeysRaw = previousKeys;
  });

  it('external handoff auth rejects disabled, missing, unknown, and invalid keys safely', async () => {
    const previous = config.devpilotExternalApiKeysRaw;
    config.devpilotExternalApiKeysRaw = '';
    const disabled = await request(app).get('/api/external/ai-handoffs');
    expect(disabled.status).toBe(403);
    expect(disabled.body).toMatchObject({ ok: false });

    config.devpilotExternalApiKeysRaw = 'external-system-a:dev-key-a';
    const missingSource = await request(app).get('/api/external/ai-handoffs').set('X-DevPilot-Api-Key', 'dev-key-a');
    expect(missingSource.status).toBe(403);
    const unknown = await request(app).get('/api/external/ai-handoffs').set('X-DevPilot-Source-System', 'other').set('X-DevPilot-Api-Key', 'dev-key-a');
    expect(unknown.status).toBe(403);
    const invalid = await request(app).get('/api/external/ai-handoffs').set('X-DevPilot-Source-System', 'external-system-a').set('X-DevPilot-Api-Key', 'wrong-key');
    expect(invalid.status).toBe(403);
    expect(JSON.stringify(invalid.body)).not.toContain('wrong-key');
    config.devpilotExternalApiKeysRaw = previous;
  });

  it('external handoff create is side-effect-free and returns safe records', async () => {
    const previousKeys = config.devpilotExternalApiKeysRaw;
    config.devpilotExternalApiKeysRaw = 'external-system-a:dev-key-a';
    const agent = request.agent(app);
    const session = await register(agent, 'external-task-owner@example.com');
    const taskId = insert(
      `INSERT INTO generation_tasks (user_id, tool_type, status, product_name, main_title, language, image_size, logo_mode, quantity, credits_cost, failure_refunded, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [session.user.id, 'banner', 'pending', 'External Product', 'External Title', 'zh-TW', '2K', 'keep', 1, 0, 0, new Date().toISOString(), new Date().toISOString()],
    );
    const beforeTask = get('SELECT * FROM generation_tasks WHERE id = ?', [taskId]);
    const beforeCostLogs = get('SELECT COUNT(*) AS count FROM ai_cost_logs').count;

    const response = await request(app)
      .post(`/api/external/tasks/${taskId}/handoffs`)
      .set('X-DevPilot-Source-System', 'external-system-a')
      .set('X-DevPilot-Api-Key', 'dev-key-a')
      .set('X-DevPilot-Request-Id', 'req-1')
      .send({
        from_agent: 'external-system-a',
        to_agent: 'devpilot-reviewer',
        reason: 'Manual review needed before continuing.',
        next_step: 'Review the external ticket and decide the handoff outcome.',
        risk: 'low',
        risk_level: 'medium',
        external_ref: 'external-ticket-123',
        actor_type: 'system',
        actor_id: 'external-system-a',
        secret_token: 'should-not-leak',
        image_base64: 'A'.repeat(260),
      });

    expect(response.status).toBe(201);
    expect(response.body.ok).toBe(true);
    expect(response.body.idempotent_replay).toBe(false);
    expect(response.body.execution_allowed).toBe(false);
    expect(response.body.handoff.risk).toBe('medium');
    expect(response.body.handoff.conversation_ref).toBe(`ai-task:${taskId}`);
    expect(response.body.handoff.source_system).toBe('external-system-a');
    expect(response.body.handoff.api_payload_summary).not.toHaveProperty('secret_token');
    expect(JSON.stringify(response.body)).not.toContain('dev-key-a');
    expect(JSON.stringify(response.body)).not.toContain('should-not-leak');
    expect(JSON.stringify(response.body)).not.toContain('A'.repeat(260));
    expect(get('SELECT status FROM generation_tasks WHERE id = ?', [taskId]).status).toBe(beforeTask.status);
    expect(get('SELECT COUNT(*) AS count FROM ai_cost_logs').count).toBe(beforeCostLogs);
    config.devpilotExternalApiKeysRaw = previousKeys;
  });

  it('external handoff create validates task and required fields with ok:false errors', async () => {
    const previousKeys = config.devpilotExternalApiKeysRaw;
    config.devpilotExternalApiKeysRaw = 'external-system-a:dev-key-a';
    const headers = { 'X-DevPilot-Source-System': 'external-system-a', 'X-DevPilot-Api-Key': 'dev-key-a' };
    const notFound = await request(app).post('/api/external/tasks/999999/handoffs').set(headers).send({
      from_agent: 'a',
      to_agent: 'b',
      reason: 'reason',
      next_step: 'next',
      risk: 'low',
    });
    expect(notFound.status).toBe(404);
    expect(notFound.body.ok).toBe(false);

    const agent = request.agent(app);
    const session = await register(agent, 'external-validation@example.com');
    const taskId = insert(
      `INSERT INTO generation_tasks (user_id, tool_type, status, language, image_size, logo_mode, quantity, credits_cost, failure_refunded, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [session.user.id, 'banner', 'pending', 'zh-TW', '2K', 'keep', 1, 0, 0, new Date().toISOString(), new Date().toISOString()],
    );
    const invalid = await request(app).post(`/api/external/tasks/${taskId}/handoffs`).set(headers).send({ from_agent: 'a' });
    expect(invalid.status).toBe(400);
    expect(invalid.body.ok).toBe(false);
    config.devpilotExternalApiKeysRaw = previousKeys;
  });

  it('external handoff idempotency replays existing records and ignores invalid payload JSON', async () => {
    const previousKeys = config.devpilotExternalApiKeysRaw;
    config.devpilotExternalApiKeysRaw = 'external-system-a:dev-key-a';
    const agent = request.agent(app);
    const session = await register(agent, 'external-idempotency@example.com');
    const timestamp = new Date().toISOString();
    const taskId = insert(
      `INSERT INTO generation_tasks (user_id, tool_type, status, product_name, language, image_size, logo_mode, quantity, credits_cost, failure_refunded, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [session.user.id, 'banner', 'pending', 'Idempotent Product', 'zh-TW', '2K', 'keep', 1, 0, 0, timestamp, timestamp],
    );
    insert(
      `INSERT INTO ai_handoff_logs (conversation_ref, task_id, source_system, from_agent, to_agent, status, risk, reason, next_step, execution_allowed, api_payload, hidden, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [`ai-task:${taskId}`, taskId, 'external-system-a', 'bad', 'bad', 'pending', 'low', 'bad json', 'ignore', 0, '{not-json', 0, timestamp, timestamp],
    );
    const payload = {
      from_agent: 'external-system-a',
      to_agent: 'devpilot-reviewer',
      reason: 'Manual review',
      next_step: 'Review',
      risk: 'medium',
    };
    const first = await request(app)
      .post(`/api/external/tasks/${taskId}/handoffs`)
      .set('X-DevPilot-Source-System', 'external-system-a')
      .set('X-DevPilot-Api-Key', 'dev-key-a')
      .set('X-DevPilot-Idempotency-Key', 'idem-123')
      .send(payload);
    expect(first.status).toBe(201);
    const second = await request(app)
      .post(`/api/external/tasks/${taskId}/handoffs`)
      .set('X-DevPilot-Source-System', 'external-system-a')
      .set('X-DevPilot-Api-Key', 'dev-key-a')
      .set('X-DevPilot-Idempotency-Key', 'idem-123')
      .send(payload);
    expect(second.status).toBe(200);
    expect(second.body.idempotent_replay).toBe(true);
    expect(second.body.handoff.handoff_id).toBe(first.body.handoff.handoff_id);
    expect(get('SELECT COUNT(*) AS count FROM ai_handoff_logs WHERE conversation_ref = ?', [`ai-task:${taskId}`]).count).toBe(2);
    config.devpilotExternalApiKeysRaw = previousKeys;
  });

  it('external handoff list and detail enforce source isolation and filters', async () => {
    const previousKeys = config.devpilotExternalApiKeysRaw;
    const previousAllowAll = config.devpilotExternalApiAllowAllSources;
    config.devpilotExternalApiKeysRaw = 'source-a:key-a,source-b:key-b';
    config.devpilotExternalApiAllowAllSources = false;
    const agent = request.agent(app);
    const session = await register(agent, 'external-isolation@example.com');
    const createdAt = new Date().toISOString();
    const taskA = insert(
      `INSERT INTO generation_tasks (user_id, tool_type, status, product_name, main_title, language, image_size, logo_mode, quantity, credits_cost, failure_refunded, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [session.user.id, 'banner', 'pending', 'Alpha Product', 'Alpha Title', 'zh-TW', '2K', 'keep', 1, 0, 0, createdAt, createdAt],
    );
    const createFor = (source, key, externalRef, risk = 'high') => request(app)
      .post(`/api/external/tasks/${taskA}/handoffs`)
      .set('X-DevPilot-Source-System', source)
      .set('X-DevPilot-Api-Key', key)
      .send({
        from_agent: source,
        to_agent: 'devpilot-reviewer',
        reason: `Review ${externalRef}`,
        next_step: 'Manual review',
        risk,
        external_ref: externalRef,
      });
    const a = await createFor('source-a', 'key-a', 'ticket-a', 'high');
    const b = await createFor('source-b', 'key-b', 'ticket-b', 'low');
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);

    const ownList = await request(app)
      .get('/api/external/ai-handoffs?include_all_sources=true&source_system=source-b&q=ticket&from_agent=source-a&to_agent=devpilot-reviewer&status=pending&risk=high&external_ref=ticket-a')
      .set('X-DevPilot-Source-System', 'source-a')
      .set('X-DevPilot-Api-Key', 'key-a');
    expect(ownList.status).toBe(200);
    expect(ownList.body.handoffs).toHaveLength(1);
    expect(ownList.body.handoffs[0].source_system).toBe('source-a');

    const forbiddenDetail = await request(app)
      .get(`/api/external/handoffs/${b.body.handoff.handoff_id}`)
      .set('X-DevPilot-Source-System', 'source-a')
      .set('X-DevPilot-Api-Key', 'key-a');
    expect(forbiddenDetail.status).toBe(404);

    config.devpilotExternalApiAllowAllSources = true;
    const allSources = await request(app)
      .get('/api/external/ai-handoffs?include_all_sources=true&source_system=source-b')
      .set('X-DevPilot-Source-System', 'source-a')
      .set('X-DevPilot-Api-Key', 'key-a');
    expect(allSources.status).toBe(200);
    expect(allSources.body.handoffs.some((handoff) => handoff.source_system === 'source-b')).toBe(true);
    const allowedDetail = await request(app)
      .get(`/api/external/handoffs/${b.body.handoff.handoff_id}?include_all_sources=true`)
      .set('X-DevPilot-Source-System', 'source-a')
      .set('X-DevPilot-Api-Key', 'key-a');
    expect(allowedDetail.status).toBe(200);
    expect(allowedDetail.body.handoff.api_payload).toBeUndefined();

    config.devpilotExternalApiKeysRaw = previousKeys;
    config.devpilotExternalApiAllowAllSources = previousAllowAll;
  });

  it('domain check writes a redacted report and handles admin login checks', async () => {
    const reportPath = `tmp/domain-check-test-${Date.now()}.json`;
    const adminPassword = 'domain-secret-password';
    const fetchImpl = async (url, options = {}) => {
      const parsed = new URL(url);
      if (parsed.protocol === 'http:') return new Response('', { status: 301, headers: { location: 'https://imageai.test/' } });
      const pathName = parsed.pathname;
      if (pathName === '/health') return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } });
      if (pathName === '/health/deep') {
        return new Response(JSON.stringify({ appUrl: 'https://imageai.test', checks: { queue: { driver: 'local' } } }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (pathName === '/' || pathName === '/admin') return new Response('<html>ok</html>', { status: 200, headers: { 'set-cookie': 'sid=abc; Secure; SameSite=Lax' } });
      if (pathName === '/api/session') {
        return new Response(JSON.stringify({ csrfToken: 'csrf-domain' }), { status: 200, headers: { 'set-cookie': 'sid=abc; Secure; SameSite=Lax' } });
      }
      if (pathName === '/api/auth/login') {
        const body = JSON.parse(options.body);
        expect(body.password).toBe(adminPassword);
        return new Response(JSON.stringify({ user: { email: body.email, role: 'admin' } }), { status: 200 });
      }
      return new Response(JSON.stringify({ message: 'not found' }), { status: 404 });
    };
    const report = await runDomainCheck({
      DOMAIN_CHECK_BASE_URL: 'https://imageai.test',
      DOMAIN_CHECK_ADMIN_USER: 'admin',
      DOMAIN_CHECK_ADMIN_PASSWORD: adminPassword,
      DOMAIN_CHECK_REPORT_PATH: reportPath,
    }, { fetchImpl });
    expect(report.ok).toBe(true);
    expect(report.summary.https_enabled).toBe(true);
    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain(adminPassword);
    const file = fs.readFileSync(path.resolve(config.rootDir, reportPath), 'utf8');
    expect(file).not.toContain(adminPassword);
  });

  it('domain check classifies fetch failures and writes actionable suggestions', async () => {
    const adminPassword = 'domain-password-never-save';
    const reportPath = `tmp/domain-fail-${Date.now()}.json`;
    const dnsError = new TypeError('fetch failed');
    dnsError.cause = { code: 'ENOTFOUND' };
    const fetchImpl = async () => { throw dnsError; };
    const report = await runDomainCheck({
      DOMAIN_CHECK_BASE_URL: 'https://imageai.tw',
      DOMAIN_CHECK_ADMIN_USER: 'admin',
      DOMAIN_CHECK_ADMIN_PASSWORD: adminPassword,
      DOMAIN_CHECK_REPORT_PATH: reportPath,
      DOMAIN_CHECK_TIMEOUT_MS: '20',
    }, { fetchImpl });
    expect(report.ok).toBe(false);
    expect(report.failed_step).toBe('health');
    expect(report.error_code).toBe('dns_resolve_failed');
    expect(report.suggestions).toEqual(expect.arrayContaining(['Check DNS A record @ -> 211.75.219.184.']));
    expect(report.quick_summary).toContain('App is healthy on IP:3050');
    expect(report.likely_root_cause).toEqual(expect.arrayContaining([
      'Missing apex A record for imageai.tw',
      'Certificate does not include imageai.tw',
      'Reverse proxy host imageai.tw is not matching app destination',
    ]));
    expect(report.next_manual_steps).toEqual(expect.arrayContaining([
      'Add A record @ -> 211.75.219.184 with DNS only',
      'Create Synology reverse proxy imageai.tw:443 -> http://127.0.0.1:3050',
      "Issue and assign Let's Encrypt certificate for imageai.tw and www.imageai.tw",
    ]));
    expect(report.commands_to_run).toEqual(expect.arrayContaining([
      'nslookup imageai.tw',
      'Test-NetConnection imageai.tw -Port 443',
      'curl.exe -I https://imageai.tw/health',
    ]));
    const formatted = formatDomainCheck(report);
    expect(formatted).toContain('quick_summary');
    expect(formatted).toContain('likely_root_cause');
    expect(formatted).toContain('next_manual_steps');
    expect(formatted).toContain('commands_to_run');
    expect(JSON.stringify(report)).not.toContain(adminPassword);
    expect(fs.readFileSync(path.resolve(config.rootDir, reportPath), 'utf8')).not.toContain(adminPassword);
  });

  it('domain check classifies TLS errors safely', async () => {
    const tlsError = new TypeError('fetch failed');
    tlsError.cause = { code: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' };
    const report = await runDomainCheck({
      DOMAIN_CHECK_BASE_URL: 'https://imageai.tw',
      DOMAIN_CHECK_REPORT_PATH: `tmp/domain-tls-${Date.now()}.json`,
      DOMAIN_CHECK_TIMEOUT_MS: '20',
    }, { fetchImpl: async () => { throw tlsError; } });
    expect(report.error_code).toBe('tls_certificate_failed');
    expect(JSON.stringify(report)).not.toContain('UNABLE_TO_VERIFY_LEAF_SIGNATURE'.repeat(20));
  });

  it('env check blocks worker queue with sqlite/sqljs in production and warns for local queue', () => {
    const workerSqlite = runEnvDiagnostics({
      NODE_ENV: 'production',
      APP_ENV: 'production',
      PORT: '3000',
      APP_URL: 'https://imageai.tw',
      SESSION_SECRET: 'strong-secret-value-for-test',
      AI_PROVIDER: 'openai',
      OPENAI_API_KEY: 'present',
      FILESYSTEM_DISK: 'local',
      QUEUE_DRIVER: 'worker',
      DATABASE_CLIENT: 'sqlite',
      ALLOW_SQLITE_IN_PRODUCTION: 'true',
    });
    expect(workerSqlite.ok).toBe(false);
    expect(workerSqlite.checks.some((check) => check.key === 'QUEUE_DRIVER' && check.level === 'FAIL')).toBe(true);

    const localQueue = runEnvDiagnostics({
      NODE_ENV: 'production',
      APP_ENV: 'production',
      PORT: '3000',
      APP_URL: 'https://imageai.tw',
      SESSION_SECRET: 'strong-secret-value-for-test',
      AI_PROVIDER: 'openai',
      OPENAI_API_KEY: 'present',
      FILESYSTEM_DISK: 'local',
      QUEUE_DRIVER: 'local',
      DATABASE_CLIENT: 'sqlite',
      ALLOW_SQLITE_IN_PRODUCTION: 'true',
    });
    expect(localQueue.checks.some((check) => check.key === 'QUEUE_DRIVER' && check.level === 'WARN')).toBe(true);
  });

  it('admin system includes domain readiness and queue/db readiness warnings', async () => {
    await runDomainCheck({
      DOMAIN_CHECK_BASE_URL: 'https://imageai.tw',
      DOMAIN_CHECK_REPORT_PATH: './tmp/domain-check.json',
      DOMAIN_CHECK_TIMEOUT_MS: '20',
    }, {
      fetchImpl: async () => {
        const err = new TypeError('fetch failed');
        err.cause = { code: 'ECONNREFUSED' };
        throw err;
      },
    });
    const agent = request.agent(app);
    const session = await register(agent, 'admin-system-domain@example.com');
    run('UPDATE users SET role = ? WHERE id = ?', ['admin', session.user.id]);
    const response = await agent.get('/api/admin/system');
    expect(response.status).toBe(200);
    expect(response.body.domainReadiness.status).toBe('failed');
    expect(response.body.domainReadiness.error_code).toBe('tcp_connect_failed');
    expect(response.body.domainFix.title).toBe('Domain / HTTPS Troubleshooting');
    expect(response.body.domainFix.failed_step).toBe('health');
    expect(response.body.domainFix.likely_root_cause).toContain('Missing apex A record for imageai.tw');
    expect(response.body.domainFix.next_manual_steps).toContain('Create Synology reverse proxy imageai.tw:443 -> http://127.0.0.1:3050');
    const appSource = fs.readFileSync(path.join(config.rootDir, 'src/App.jsx'), 'utf8');
    expect(appSource).toContain('Domain / HTTPS Troubleshooting');
    expect(appSource).toContain('NAS_DOMAIN_FIX.md');
    expect(response.body.databaseClient).toBeTruthy();
    expect(response.body.publicUrl).toBeTruthy();
  });

  it('README and docker compose document public trial queue guidance', () => {
    const readme = fs.readFileSync(path.join(config.rootDir, 'README.md'), 'utf8');
    const checklist = fs.readFileSync(path.join(config.rootDir, 'RELEASE_CHECKLIST.md'), 'utf8');
    const nasGuide = fs.readFileSync(path.join(config.rootDir, 'NAS_DOMAIN_FIX.md'), 'utf8');
    const compose = fs.readFileSync(path.join(config.rootDir, 'docker-compose.yml'), 'utf8');
    expect(readme).toContain('imageai.tw DNS / HTTPS Troubleshooting');
    expect(readme).toContain('NAS_DOMAIN_FIX.md');
    expect(checklist).toContain('DNS only / gray cloud');
    expect(nasGuide).toContain('Type | A');
    expect(nasGuide).toContain('211.75.219.184');
    expect(nasGuide).not.toMatch(/sk-[A-Za-z0-9_-]{8,}/);
    expect(nasGuide).not.toMatch(/AIza[0-9A-Za-z_-]{20,}/);
    expect(readme).toContain('QUEUE_DRIVER=local');
    expect(checklist).toContain('Queue / DB Readiness');
    expect(compose).toContain('profiles:');
    expect(compose).toContain('worker');
    expect(readme).not.toMatch(/sk-[A-Za-z0-9]/);
  });

  it('domain manual guide prints DNS A guidance without network or credentials', () => {
    const result = spawnSync(process.execPath, ['server/cli/domain-manual-guide.js'], {
      cwd: config.rootDir,
      encoding: 'utf8',
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('DNS A @ -> 211.75.219.184');
    expect(result.stdout).toContain('DNS only / gray cloud');
    expect(result.stdout).toContain('NAS_DOMAIN_FIX.md');
    expect(result.stdout).not.toMatch(/sk-[A-Za-z0-9_-]{8,}/);
  });

  it('admin system reports default password warnings and supports password change', async () => {
    ensureAdmin('admin', await bcrypt.hash('1234', 10), 'Admin');
    const agent = request.agent(app);
    let token = await csrf(agent);
    const login = await agent.post('/api/auth/login').set('x-csrf-token', token).send({ email: 'admin', password: '1234' });
    expect(login.status).toBe(200);
    token = (await agent.get('/api/session')).body.csrfToken;
    const system = await agent.get('/api/admin/system');
    expect(system.status).toBe(200);
    expect(system.body.securityWarnings.some((warning) => warning.code === 'default_admin_password')).toBe(true);
    const previousAppUrl = config.appUrl;
    const previousPublicUrl = config.publicUrl;
    config.appUrl = 'https://imageai.tw';
    config.publicUrl = 'https://imageai.tw';
    const publicSystem = await agent.get('/api/admin/system');
    const defaultWarning = publicSystem.body.securityWarnings.find((warning) => warning.code === 'default_admin_password');
    expect(defaultWarning.blocking).toBe(false);
    expect(defaultWarning.testing_only).toBe(true);
    expect(defaultWarning.message).toContain('Testing only');
    config.appUrl = previousAppUrl;
    config.publicUrl = previousPublicUrl;

    const changed = await agent
      .post('/api/auth/change-password')
      .set('x-csrf-token', token)
      .send({ current_password: '1234', new_password: 'new-admin-pass', confirm_password: 'new-admin-pass' });
    expect(changed.status).toBe(200);
    await agent.post('/api/auth/logout').set('x-csrf-token', token);

    const nextAgent = request.agent(app);
    const nextToken = await csrf(nextAgent);
    const oldLogin = await nextAgent.post('/api/auth/login').set('x-csrf-token', nextToken).send({ email: 'admin', password: '1234' });
    expect(oldLogin.status).not.toBe(200);
    const newLogin = await nextAgent.post('/api/auth/login').set('x-csrf-token', nextToken).send({ email: 'admin', password: 'new-admin-pass' });
    expect(newLogin.status).toBe(200);
    const changedSystem = await nextAgent.get('/api/admin/system');
    expect(changedSystem.body.securityWarnings.some((warning) => warning.code === 'default_admin_password')).toBe(false);
  });

  it('admin provider playground runs fake text safely and audits the action', async () => {
    const agent = request.agent(app);
    const session = await register(agent, 'provider-playground-admin@example.com');
    run('UPDATE users SET role = ? WHERE id = ?', ['admin', session.user.id]);
    const token = (await agent.get('/api/session')).body.csrfToken;
    const response = await agent
      .post('/api/admin/provider-playground')
      .set('x-csrf-token', token)
      .send({ provider: 'fake', capability: 'chat', prompt: 'Return exactly: FAKE_OK' });
    expect(response.status).toBe(200);
    expect(response.body.provider).toBe('fake');
    expect(response.body.output).toBe('FAKE_OK');
    const audit = listAuditLogs({ action: 'provider_playground_run', limit: 5 }).logs;
    expect(audit.length).toBeGreaterThan(0);
    expect(JSON.stringify(audit)).not.toContain('OPENAI_API_KEY');
  });

  it('admin DevPilot dashboard lists and reviews handoffs without exposing raw payload', async () => {
    const previousKeys = config.devpilotExternalApiKeysRaw;
    config.devpilotExternalApiKeysRaw = 'source-rc4:key-rc4';
    const agent = request.agent(app);
    const session = await register(agent, 'devpilot-dashboard-admin@example.com');
    run('UPDATE users SET role = ? WHERE id = ?', ['admin', session.user.id]);
    const timestamp = new Date().toISOString();
    const taskId = insert(
      `INSERT INTO generation_tasks (user_id, tool_type, status, product_name, language, image_size, logo_mode, quantity, credits_cost, failure_refunded, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [session.user.id, 'banner', 'pending', 'RC4 Product', 'zh-TW', '2K', 'keep', 1, 0, 0, timestamp, timestamp],
    );
    const created = await request(app)
      .post(`/api/external/tasks/${taskId}/handoffs`)
      .set('X-DevPilot-Source-System', 'source-rc4')
      .set('X-DevPilot-Api-Key', 'key-rc4')
      .send({ from_agent: 'source-rc4', to_agent: 'devpilot-reviewer', reason: 'Review', next_step: 'Review now', risk: 'low', external_ref: 'rc4-ticket' });
    expect(created.status).toBe(201);

    const dashboard = await agent.get('/api/admin/devpilot?source_system=source-rc4');
    expect(dashboard.status).toBe(200);
    expect(dashboard.body.recentHandoffs).toHaveLength(1);
    expect(dashboard.body.recentHandoffs[0].api_payload).toBeUndefined();
    expect(JSON.stringify(dashboard.body)).not.toContain('key-rc4');

    const token = (await agent.get('/api/session')).body.csrfToken;
    const reviewed = await agent.post(`/api/admin/handoffs/${created.body.handoff.handoff_id}/reviewed`).set('x-csrf-token', token).send({ note: 'ok' });
    expect(reviewed.status).toBe(200);
    expect(reviewed.body.handoff.api_payload_summary.admin_review.reviewed).toBe(true);
    config.devpilotExternalApiKeysRaw = previousKeys;
  });

  it('RC5 task actions retry, duplicate, regeneration, and UI handoff stay safe', async () => {
    const previousKeys = config.devpilotExternalApiKeysRaw;
    config.devpilotExternalApiKeysRaw = 'source-rc5:key-rc5';
    const ownerAgent = request.agent(app);
    const ownerSession = await register(ownerAgent, 'rc5-actions-owner@example.com');
    const taskResponse = await createBannerTask(ownerAgent, ownerSession.token);
    expect(taskResponse.status).toBe(201);
    await waitFor(() => get('SELECT status FROM generation_tasks WHERE id = ?', [taskResponse.body.task_id])?.status === 'success');
    const output = get("SELECT * FROM task_images WHERE task_id = ? AND type = 'output'", [taskResponse.body.task_id]);
    expect(output).toBeTruthy();

    const duplicate = await ownerAgent
      .post(`/api/tasks/${taskResponse.body.task_id}/duplicate`)
      .set('x-csrf-token', ownerSession.token)
      .send({});
    expect(duplicate.status).toBe(201);
    expect(duplicate.body.copied_from_task_id).toBe(taskResponse.body.task_id);
    expect(duplicate.body.outputs_copied).toBe(false);
    expect(get("SELECT COUNT(*) AS count FROM task_images WHERE task_id = ? AND type = 'output'", [duplicate.body.task_id]).count).toBe(0);
    expect(get('SELECT product_name FROM generation_tasks WHERE id = ?', [duplicate.body.task_id]).product_name).toBe(
      get('SELECT product_name FROM generation_tasks WHERE id = ?', [taskResponse.body.task_id]).product_name,
    );

    const regeneration = await ownerAgent
      .post(`/api/tasks/${taskResponse.body.task_id}/regenerations`)
      .set('x-csrf-token', ownerSession.token)
      .send({ task_image_id: output.id, reason: 'try another crop' });
    expect(regeneration.status).toBe(201);
    expect(regeneration.body.regeneration.status).toBe('requested');
    expect(regeneration.body.regeneration.metadata_json).toContain('requested_by');
    expect(regeneration.body.regeneration.output_url).toContain('/storage/');

    const handoff = await ownerAgent
      .post(`/api/tasks/${taskResponse.body.task_id}/devpilot-handoff`)
      .set('x-csrf-token', ownerSession.token)
      .send({ reason: 'review this task' });
    expect(handoff.status).toBe(201);
    expect(handoff.body.execution_allowed).toBe(false);
    expect(handoff.body.handoff.external_ref).toContain(`task-${taskResponse.body.task_id}-`);
    expect(JSON.stringify(handoff.body)).not.toContain('key-rc5');

    const failedTaskId = insert(
      `INSERT INTO generation_tasks (user_id, tool_type, status, language, image_size, logo_mode, quantity, credits_cost, failure_refunded, retry_count, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [ownerSession.user.id, 'banner', 'failed', 'zh-TW', '2K', 'keep', 1, 0, 0, 0, new Date().toISOString(), new Date().toISOString()],
    );
    const retry = await ownerAgent.post(`/api/tasks/${failedTaskId}/retry`).set('x-csrf-token', ownerSession.token).send({});
    expect(retry.status).toBe(200);
    expect(retry.body.task.retry_count).toBe(1);
    expect(listAuditLogs({ action: 'task_retry' }).logs.length).toBeGreaterThan(0);

    const otherAgent = request.agent(app);
    const otherSession = await register(otherAgent, 'rc5-actions-other@example.com');
    const denied = await otherAgent.post(`/api/tasks/${failedTaskId}/retry`).set('x-csrf-token', otherSession.token).send({});
    expect(denied.status).toBe(403);

    const adminAgent = request.agent(app);
    const adminSession = await register(adminAgent, 'rc5-actions-admin@example.com');
    run('UPDATE users SET role = ? WHERE id = ?', ['admin', adminSession.user.id]);
    run("UPDATE generation_tasks SET status = 'failed' WHERE id = ?", [failedTaskId]);
    const adminRetry = await adminAgent.post(`/api/admin/tasks/${failedTaskId}/retry`).set('x-csrf-token', adminSession.token).send({});
    expect(adminRetry.status).toBe(200);
    expect(adminRetry.body.task.retry_count).toBe(2);
    config.devpilotExternalApiKeysRaw = previousKeys;
  });

  it('RC5 assets support share links, batch actions, CSV export, and public redaction', async () => {
    const agent = request.agent(app);
    const session = await register(agent, 'rc5-assets@example.com');
    const task = await createBannerTask(agent, session.token);
    await waitFor(() => get('SELECT status FROM generation_tasks WHERE id = ?', [task.body.task_id])?.status === 'success');
    const assets = await agent.get('/api/assets?type=output');
    const asset = assets.body.assets.find((item) => item.task_id === task.body.task_id);
    expect(asset).toBeTruthy();

    const batch = await agent
      .post('/api/assets/batch')
      .set('x-csrf-token', session.token)
      .send({ ids: [asset.id], action: 'tag', tags: 'hero,trial' });
    expect(batch.status).toBe(200);
    expect(batch.body.updated).toBe(1);
    expect((await agent.get('/api/assets?type=output&q=hero')).body.assets.some((item) => item.id === asset.id)).toBe(true);

    const csv = await agent.get(`/api/assets.csv?ids=${asset.id}`);
    expect(csv.status).toBe(200);
    expect(csv.text).toContain('task_id');
    expect(csv.text).not.toContain('password');
    expect(csv.text).not.toContain('api_key');

    const share = await agent.post(`/api/assets/${asset.id}/share`).set('x-csrf-token', session.token).send({});
    expect(share.status).toBe(200);
    expect(share.body.share.token.length).toBeGreaterThan(20);
    const publicJson = await request(app).get(`/api/share/${share.body.share.token}`);
    expect(publicJson.status).toBe(200);
    expect(publicJson.body.asset.task_id).toBe(task.body.task_id);
    expect(JSON.stringify(publicJson.body)).not.toContain(session.user.email);
    expect(JSON.stringify(publicJson.body)).not.toContain('raw_response');
    const publicHtml = await request(app).get(`/share/${share.body.share.token}`);
    expect(publicHtml.status).toBe(200);
    expect(publicHtml.text).toContain(`/share/${share.body.share.token}/image`);
    expect(publicHtml.text).not.toContain(session.user.email);
    const revoke = await agent.post(`/api/assets/${asset.id}/share/revoke`).set('x-csrf-token', session.token).send({});
    expect(revoke.status).toBe(200);
    expect((await request(app).get(`/api/share/${share.body.share.token}`)).status).toBe(404);
  });

  it('RC5 admin credits, users, security headers, DevPilot handoff filters, and trial check are safe', async () => {
    const adminAgent = request.agent(app);
    const adminSession = await register(adminAgent, 'rc5-admin@example.com');
    run('UPDATE users SET role = ? WHERE id = ?', ['admin', adminSession.user.id]);
    run("UPDATE users SET role = 'user' WHERE role = 'admin' AND id != ?", [adminSession.user.id]);
    const userAgent = request.agent(app);
    const userSession = await register(userAgent, 'rc5-credit-user@example.com');

    const missingReason = await adminAgent
      .post(`/api/admin/users/${userSession.user.id}/adjust-credits`)
      .set('x-csrf-token', adminSession.token)
      .send({ amount: 10, note: '' });
    expect(missingReason.status).toBe(422);
    const negative = await adminAgent
      .post(`/api/admin/users/${userSession.user.id}/adjust-credits`)
      .set('x-csrf-token', adminSession.token)
      .send({ amount: -9999, note: 'too much' });
    expect(negative.status).toBe(422);
    const adjust = await adminAgent
      .post(`/api/admin/users/${userSession.user.id}/adjust-credits`)
      .set('x-csrf-token', adminSession.token)
      .send({ amount: 10, note: 'trial topup' });
    expect(adjust.status).toBe(200);
    const credits = await adminAgent.get('/api/admin/credits');
    expect(credits.status).toBe(200);
    expect(credits.body.ledger.some((tx) => tx.note === 'trial topup')).toBe(true);
    expect((await adminAgent.get('/api/admin/credits.csv')).text).not.toContain('password');

    const disableLastAdmin = await adminAgent
      .post(`/api/admin/users/${adminSession.user.id}/status`)
      .set('x-csrf-token', adminSession.token)
      .send({ status: 'suspended' });
    expect(disableLastAdmin.status).toBe(422);
    const suspended = await adminAgent
      .post(`/api/admin/users/${userSession.user.id}/status`)
      .set('x-csrf-token', adminSession.token)
      .send({ status: 'suspended' });
    expect(suspended.status).toBe(200);
    const disabledLoginAgent = request.agent(app);
    const disabledToken = await csrf(disabledLoginAgent);
    const disabledLogin = await disabledLoginAgent
      .post('/api/auth/login')
      .set('x-csrf-token', disabledToken)
      .send({ email: 'rc5-credit-user@example.com', password: 'password123' });
    expect(disabledLogin.status).toBe(403);

    const health = await request(app).get('/health');
    expect(health.headers['x-content-type-options']).toBe('nosniff');
    expect(health.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(health.headers['referrer-policy']).toBe('same-origin');
    expect(health.headers['content-security-policy']).toContain("default-src 'self'");

    const suite = await adminAgent.post('/api/admin/devpilot/test-suite').set('x-csrf-token', adminSession.token).send({});
    expect(suite.status).toBe(200);
    expect(suite.body.raw_key_returned).toBe(false);
    expect(JSON.stringify(suite.body)).not.toContain('key_hash');
    const handoffs = await adminAgent.get('/api/admin/devpilot/handoffs?include_test=1');
    expect(handoffs.status).toBe(200);
    expect(handoffs.body.handoffs.every((handoff) => handoff.safe_payload_summary)).toBe(true);

    const trial = await runTrialCheck({ reportPath: `tmp/trial-check-test-${Date.now()}.json` });
    expect(trial.checks.some((check) => check.name === 'provider_registry_summary')).toBe(true);
    expect(trial.checks.some((check) => check.name === 'queue_mode_check' && check.status === 'WARN')).toBe(true);
    expect(trial.checks.some((check) => check.name === 'public_domain_health' && check.status === 'SKIP')).toBe(true);
    expect(trial.summary.devpilot_key_count).toBeDefined();
    expect(JSON.stringify(trial)).not.toMatch(/sk-[A-Za-z0-9_-]{8,}/);
    expect(fs.existsSync(path.resolve(config.rootDir, trial.report_path))).toBe(true);

    const previousNodeEnv = config.nodeEnv;
    const previousAppEnv = config.appEnv;
    const previousAppUrl = config.appUrl;
    config.nodeEnv = 'production';
    config.appEnv = 'production';
    config.appUrl = 'https://imageai.tw';
    ensureAdmin('admin', await bcrypt.hash('1234', 10), 'Admin');
    const productionTrial = await runTrialCheck({ reportPath: `tmp/trial-check-production-${Date.now()}.json` });
    expect(productionTrial.ok).toBe(false);
    expect(productionTrial.summary.go_no_go.public_trial).toBe('Conditional Go');
    expect(productionTrial.summary.go_no_go.production_release).toBe('No-Go');
    expect(productionTrial.checks.find((check) => check.name === 'default_admin_password_warning').status).toBe('FAIL');
    config.nodeEnv = previousNodeEnv;
    config.appEnv = previousAppEnv;
    config.appUrl = previousAppUrl;
  });

  it('RC8 trial banner, invite gate, feedback, analytics, share, and cleanup stay safe', async () => {
    const previousInviteEnabled = config.inviteCodeEnabled;
    const previousInviteCode = config.trialInviteCode;
    const previousInviteLabel = config.inviteCodeLabel;
    const previousTrialMode = config.trialMode;
    const previousTrialMessage = config.trialModeMessage;
    const previousNodeEnv = config.nodeEnv;
    const previousAppEnv = config.appEnv;
    config.trialMode = true;
    config.trialModeMessage = '目前為測試站，資料與圖片可能會被清理。';
    config.inviteCodeEnabled = true;
    config.trialInviteCode = 'trial-ok';
    config.inviteCodeLabel = 'Trial invite code';

    const bootstrap = await request(app).get('/api/bootstrap');
    expect(bootstrap.body.trialMode.enabled).toBe(true);
    expect(bootstrap.body.registration.invite_code_enabled).toBe(true);
    expect(JSON.stringify(bootstrap.body)).not.toContain('trial-ok');
    const appSource = fs.readFileSync(path.resolve(config.rootDir, 'src/App.jsx'), 'utf8');
    expect(appSource).toContain('測試模式');
    expect(appSource).toContain('Trial invite code');

    const missingAgent = request.agent(app);
    let token = await csrf(missingAgent);
    const missing = await missingAgent
      .post('/api/auth/register')
      .set('x-csrf-token', token)
      .send({ name: 'Trial User', email: 'invite-missing@example.com', password: 'password123', terms: true });
    expect(missing.status).toBe(403);
    expect(missing.text).not.toContain('trial-ok');

    const wrongAgent = request.agent(app);
    token = await csrf(wrongAgent);
    const wrong = await wrongAgent
      .post('/api/auth/register')
      .set('x-csrf-token', token)
      .send({ name: 'Trial User', email: 'invite-wrong@example.com', password: 'password123', terms: true, invite_code: 'wrong' });
    expect(wrong.status).toBe(403);

    const invitedAgent = request.agent(app);
    token = await csrf(invitedAgent);
    const invited = await invitedAgent
      .post('/api/auth/register')
      .set('x-csrf-token', token)
      .send({ name: 'Trial User', email: 'invite-ok@example.com', password: 'password123', terms: true, invite_code: 'trial-ok' });
    expect(invited.status).toBe(201);
    expect(JSON.stringify(invited.body)).not.toContain('trial-ok');
    config.inviteCodeEnabled = false;
    const openSession = await register(request.agent(app), 'invite-disabled@example.com');
    expect(openSession.user.email).toBe('invite-disabled@example.com');

    const feedbackToken = (await invitedAgent.get('/api/session')).body.csrfToken;
    const feedback = await invitedAgent
      .post('/api/feedback')
      .set('x-csrf-token', feedbackToken)
      .send({
        type: 'quality',
        severity: 'high',
        title: 'Image issue',
        description: 'The output has api_key=sk-secretvalue1234567890 and should redact it.',
        task_id: 1,
        asset_url: '/share/example/image',
      });
    expect(feedback.status).toBe(201);
    expect(feedback.body.report.description).toContain('[redacted_secret]');

    const adminAgent = request.agent(app);
    const adminSession = await register(adminAgent, 'rc8-admin@example.com');
    run('UPDATE users SET role = ? WHERE id = ?', ['admin', adminSession.user.id]);
    const adminToken = (await adminAgent.get('/api/session')).body.csrfToken;
    const adminFeedback = await adminAgent.get('/api/admin/feedback?status=open');
    expect(adminFeedback.body.reports.some((report) => report.id === feedback.body.report.id)).toBe(true);
    const update = await adminAgent
      .post(`/api/admin/feedback/${feedback.body.report.id}`)
      .set('x-csrf-token', adminToken)
      .send({ status: 'reviewing', admin_notes: 'triaged' });
    expect(update.body.report.status).toBe('reviewing');
    const userFeedbackList = await invitedAgent.get('/api/admin/feedback');
    expect(userFeedbackList.status).toBe(403);

    const oldDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
    const taskId = insert(
      `INSERT INTO generation_tasks (user_id, tool_type, status, product_name, language, image_size, logo_mode, quantity, credits_cost, failure_refunded, error_message, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [invited.body.user.id, 'banner', 'failed', 'RC8 Product', 'zh-TW', '2K', 'keep', 1, 0, 0, 'old failure', oldDate, oldDate],
    );
    const imageId = insert(
      `INSERT INTO task_images (task_id, type, storage_path, mime_type, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [taskId, 'output', 'outputs/rc8-output.png', 'image/png', oldDate, oldDate],
    );
    insert(
      `INSERT INTO asset_metadata (task_image_id, user_id, favorite, archived, tags, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [imageId, invited.body.user.id, 0, 1, 'trial', 'archived', oldDate, oldDate],
    );
    insert(
      `INSERT INTO ai_handoff_logs (conversation_ref, task_id, source_system, from_agent, to_agent, status, risk, reason, next_step, execution_allowed, hidden, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ['rc8', taskId, 'test-suite', 'ad-studio-ai', 'devpilot', 'pending', 'low', 'test', 'none', 0, 1, oldDate, oldDate],
    );
    const share = await invitedAgent.post(`/api/assets/${imageId}/share`).set('x-csrf-token', feedbackToken).send({});
    expect(share.status).toBe(200);
    const sharePage = await request(app).get(share.body.share.share_url);
    expect(sharePage.status).toBe(200);
    expect(sharePage.text).toContain('由 imageai.tw 生成');
    expect(sharePage.text).not.toContain('invite-ok@example.com');
    expect(sharePage.text).not.toContain('raw_response');
    const revoke = await invitedAgent.post(`/api/assets/${imageId}/share/revoke`).set('x-csrf-token', feedbackToken).send({});
    expect(revoke.status).toBe(200);
    expect((await request(app).get(share.body.share.share_url)).status).toBe(404);
    expect((await request(app).get('/share/not-a-real-token-000')).status).toBe(404);

    const trialAnalytics = await adminAgent.get('/api/admin/trial');
    expect(trialAnalytics.status).toBe(200);
    expect(trialAnalytics.body.feedback_open_count).toBeGreaterThanOrEqual(0);
    expect(JSON.stringify(trialAnalytics.body)).not.toMatch(/sk-[A-Za-z0-9_-]{8,}/);

    const cleanup = runTrialCleanup({
      dryRun: true,
      olderThanDays: 7,
      reportPath: `tmp/trial-cleanup-test-${Date.now()}.json`,
    });
    expect(cleanup.dry_run).toBe(true);
    expect(cleanup.selected.old_failed_tasks.some((task) => task.id === taskId)).toBe(true);
    expect(get('SELECT deleted_at FROM generation_tasks WHERE id = ?', [taskId]).deleted_at).toBeNull();
    expect(JSON.stringify(cleanup)).not.toMatch(/sk-[A-Za-z0-9_-]{8,}/);
    expect(() => assertSafeTrialPath(path.resolve(config.rootDir, 'README.md'))).toThrow(/unsafe trial cleanup path|protected/);
    config.nodeEnv = 'production';
    config.appEnv = 'production';
    expect(() => runTrialCleanup({ dryRun: false, allowWrite: false })).toThrow(/blocked in production/);
    config.nodeEnv = previousNodeEnv;
    config.appEnv = previousAppEnv;

    const trial = await runTrialCheck({ reportPath: `tmp/rc8-trial-check-${Date.now()}.json` });
    expect(trial.checks.find((check) => check.name === 'trial_mode').status).toBe('PASS');
    expect(trial.checks.find((check) => check.name === 'default_admin_password_warning').status).toBe('WARN');
    expect(trial.ok).toBe(true);

    config.inviteCodeEnabled = previousInviteEnabled;
    config.trialInviteCode = previousInviteCode;
    config.inviteCodeLabel = previousInviteLabel;
    config.trialMode = previousTrialMode;
    config.trialModeMessage = previousTrialMessage;
  });

  it('RC9 admin bootstrap gates classify trial and production password readiness safely', async () => {
    const previous = {
      nodeEnv: config.nodeEnv,
      appEnv: config.appEnv,
      trialMode: config.trialMode,
      bootstrapUsername: config.admin.bootstrapUsername,
      bootstrapPassword: config.admin.bootstrapPassword,
      bootstrapPasswordConfigured: config.admin.bootstrapPasswordConfigured,
      allowDefaultPassword: config.admin.allowDefaultPassword,
      requireSecurePassword: config.admin.requireSecurePassword,
    };

    config.nodeEnv = 'development';
    config.appEnv = 'development';
    config.trialMode = true;
    config.admin.bootstrapUsername = 'admin';
    config.admin.bootstrapPassword = '1234';
    config.admin.bootstrapPasswordConfigured = false;
    config.admin.allowDefaultPassword = false;
    config.admin.requireSecurePassword = true;
    ensureAdmin('admin', await bcrypt.hash('1234', 10), 'Admin');
    const trial = await runTrialCheck({ reportPath: `tmp/rc9-trial-password-${Date.now()}.json` });
    const trialPasswordCheck = trial.checks.find((check) => check.name === 'default_admin_password_warning');
    expect(trialPasswordCheck.status).toBe('WARN');
    expect(trial.summary.go_no_go.public_trial).toBe('Conditional Go');
    expect(trial.summary.go_no_go.production_release).toBe('No-Go');

    config.nodeEnv = 'production';
    config.appEnv = 'production';
    config.trialMode = false;
    config.admin.bootstrapPassword = '1234';
    config.admin.bootstrapPasswordConfigured = true;
    config.admin.allowDefaultPassword = true;
    ensureAdmin('admin', await bcrypt.hash('1234', 10), 'Admin');
    const productionWeak = await runTrialCheck({ reportPath: `tmp/rc9-production-weak-${Date.now()}.json` });
    expect(productionWeak.ok).toBe(false);
    expect(productionWeak.checks.find((check) => check.name === 'default_admin_password_warning').status).toBe('FAIL');
    expect(productionWeak.summary.go_no_go.production_release).toBe('No-Go');
    const productionWeakAgent = request.agent(app);
    const productionWeakToken = await csrf(productionWeakAgent);
    const productionWeakLogin = await productionWeakAgent
      .post('/api/auth/login')
      .set('x-csrf-token', productionWeakToken)
      .send({ email: 'admin', password: '1234' });
    expect(productionWeakLogin.status).toBe(403);
    expect(productionWeakLogin.text).not.toContain('1234');

    const strongPassword = 'Str0ngAdminPass!987';
    config.admin.bootstrapPassword = strongPassword;
    config.admin.bootstrapPasswordConfigured = true;
    ensureAdmin('admin', await bcrypt.hash(strongPassword, 10), 'Admin');
    const productionStrong = await runTrialCheck({ reportPath: `tmp/rc9-production-strong-${Date.now()}.json` });
    const strongCheck = productionStrong.checks.find((check) => check.name === 'admin_password_check');
    expect(strongCheck.status).toBe('PASS');
    expect(productionStrong.summary.go_no_go.production_release).toBe('No-Go');
    expect(productionStrong.summary.go_no_go.blockers).toContain('R2/S3 live storage is not accepted');
    expect(JSON.stringify(productionStrong)).not.toContain(strongPassword);
    expect(fs.readFileSync(path.resolve(config.rootDir, productionStrong.report_path), 'utf8')).not.toContain(strongPassword);
    const productionStrongAgent = request.agent(app);
    const productionStrongToken = await csrf(productionStrongAgent);
    const productionStrongLogin = await productionStrongAgent
      .post('/api/auth/login')
      .set('x-csrf-token', productionStrongToken)
      .send({ email: 'admin', password: strongPassword });
    expect(productionStrongLogin.status).toBe(200);

    config.nodeEnv = previous.nodeEnv;
    config.appEnv = previous.appEnv;
    config.trialMode = previous.trialMode;
    config.admin.bootstrapUsername = previous.bootstrapUsername;
    config.admin.bootstrapPassword = previous.bootstrapPassword;
    config.admin.bootstrapPasswordConfigured = previous.bootstrapPasswordConfigured;
    config.admin.allowDefaultPassword = previous.allowDefaultPassword;
    config.admin.requireSecurePassword = previous.requireSecurePassword;
  });

  it('RC9 HTTPS redirect and proxy trust gates are opt-in and method-aware', async () => {
    const previous = {
      forceHttps: config.forceHttps,
      trustProxy: config.trustProxy,
      httpsRedirectStatus: config.httpsRedirectStatus,
    };
    config.forceHttps = false;
    expect((await request(app).get('/health')).status).toBe(200);

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ad-studio-https-test-'));
    config.forceHttps = true;
    config.trustProxy = true;
    config.httpsRedirectStatus = 308;
    const httpsApp = await createApp({ dbPath: path.join(dir, 'database.sqlite') });

    const forwarded = await request(httpsApp).get('/health').set('x-forwarded-proto', 'https');
    expect(forwarded.status).toBe(200);
    const redirect = await request(httpsApp).get('/health').set('host', 'imageai.test');
    expect(redirect.status).toBe(308);
    expect(redirect.headers.location).toBe('https://imageai.test/health');
    const post = await request(httpsApp).post('/api/auth/login').send({ email: 'admin', password: '1234' });
    expect(post.status).toBe(400);
    expect(post.body).toEqual({ ok: false, error: 'https_required' });

    config.forceHttps = previous.forceHttps;
    config.trustProxy = previous.trustProxy;
    config.httpsRedirectStatus = previous.httpsRedirectStatus;
  });
});
