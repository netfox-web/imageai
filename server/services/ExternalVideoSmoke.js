import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { config } from '../config/index.js';
import { closeDatabase, all, get, now } from '../db/database.js';
import { initDatabase } from '../db/database.js';
import { migrate } from '../db/migrations.js';
import { seed } from '../db/seeders.js';
import { CreditTransaction, User } from '../models/index.js';
import { GenerateTaskJob } from '../jobs/GenerateTaskJob.js';
import { taskService } from './TaskService.js';

const smokePng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p94AAAAASUVORK5CYII=',
  'base64',
);

const successModes = new Set(['success', 'artifacts']);
const failureModes = new Set(['fail', 'missing_video', 'server_error']);

function check(key, ok, message, details = {}) {
  return { key, ok: Boolean(ok), message, details };
}

function expectedOutcome(expectedMode = 'auto') {
  const mode = String(expectedMode || 'auto').toLowerCase();
  if (successModes.has(mode)) return 'success';
  if (failureModes.has(mode)) return 'failed';
  return 'auto';
}

export async function runExternalVideoSmoke({
  baseUrl = config.externalAiBaseUrl || process.env.EXTERNAL_AI_BASE_URL || '',
  apiKey = config.externalAiApiKey || process.env.EXTERNAL_AI_API_KEY || '',
  expectedMode = process.env.EXTERNAL_VIDEO_SMOKE_EXPECT || process.env.MOCK_EXTERNAL_MODE || 'auto',
  dbPath = '',
  fetchImpl = null,
} = {}) {
  if (!baseUrl) {
    return {
      ok: false,
      outcome: 'not_configured',
      checks: [check('config.external_base_url', false, 'EXTERNAL_AI_BASE_URL is not configured.')],
      hint: 'Set EXTERNAL_AI_BASE_URL=http://localhost:3099 before running smoke:external-video.',
    };
  }

  const tempDir = dbPath ? path.dirname(dbPath) : fs.mkdtempSync(path.join(os.tmpdir(), 'external-video-smoke-'));
  const smokeDbPath = dbPath || path.join(tempDir, 'database.sqlite');
  const previous = {
    externalAiBaseUrl: config.externalAiBaseUrl,
    externalAiApiKey: config.externalAiApiKey,
    queueDriver: config.queueDriver,
    aiProvider: config.aiProvider,
    refundOnFailure: config.refundOnFailure,
  };
  const previousFetch = global.fetch;

  try {
    if (fetchImpl) global.fetch = fetchImpl;
    config.externalAiBaseUrl = baseUrl;
    config.externalAiApiKey = apiKey;
    config.queueDriver = 'worker';
    config.aiProvider = 'fake';
    config.refundOnFailure = true;

    await initDatabase({ dbPath: smokeDbPath });
    await migrate();
    await seed();

    const userId = createSmokeUser();
    const startingBalance = get('SELECT credits_balance FROM users WHERE id = ?', [userId]).credits_balance;
    const created = await taskService.createTask(
      userId,
      {
        tool_type: 'image_to_video',
        product_name: 'External Video Smoke Product',
        main_title: 'External video smoke',
        custom_prompt: 'Create a short product video smoke test.',
        provider: 'external',
        capability: 'image_to_video',
        metadata_json: JSON.stringify({ duration_seconds: 5, aspect_ratio: '1:1', smoke: true }),
      },
      [
        {
          originalname: 'smoke-product.png',
          mimetype: 'image/png',
          buffer: smokePng,
          size: smokePng.length,
        },
      ],
    );

    await GenerateTaskJob.handle(created.task_id);
    return inspectSmokeResult({
      taskId: created.task_id,
      userId,
      startingBalance,
      expected: expectedOutcome(expectedMode),
      dbPath: smokeDbPath,
      baseUrl,
    });
  } catch (error) {
    return {
      ok: false,
      outcome: 'error',
      checks: [check('smoke.unexpected_error', false, error.message)],
      error,
      db_path: smokeDbPath,
      base_url: baseUrl,
    };
  } finally {
    Object.assign(config, previous);
    if (fetchImpl) global.fetch = previousFetch;
    closeDatabase();
  }
}

export function formatExternalVideoSmokeResult(result) {
  const lines = [
    '[smoke:external-video] External image_to_video smoke',
    `[smoke:external-video] outcome=${result.outcome || 'unknown'} ok=${result.ok ? 'true' : 'false'}`,
  ];
  if (result.task_id) lines.push(`[smoke:external-video] task_id=${result.task_id}`);
  if (result.base_url) lines.push(`[smoke:external-video] base_url=${result.base_url}`);
  if (result.db_path) lines.push(`[smoke:external-video] db_path=${result.db_path}`);
  (result.checks || []).forEach((item) => {
    lines.push(`[${item.ok ? 'PASS' : 'FAIL'}] ${item.key}: ${item.message}`);
  });
  if (result.hint) lines.push(`[smoke:external-video] hint: ${result.hint}`);
  return lines.join('\n');
}

function createSmokeUser() {
  const userId = User.create({
    name: 'External Video Smoke',
    email: `external-video-smoke-${Date.now()}@example.com`,
    password: 'smoke-only-no-login',
    google_id: null,
    role: 'user',
    credits_balance: 100,
    status: 'active',
  });
  CreditTransaction.create({
    user_id: userId,
    type: 'grant',
    amount: 100,
    balance_after: 100,
    related_task_id: null,
    note: 'External video smoke grant',
    created_at: now(),
    updated_at: now(),
  });
  return userId;
}

function inspectSmokeResult({ taskId, userId, startingBalance, expected, dbPath, baseUrl }) {
  const task = get('SELECT * FROM generation_tasks WHERE id = ?', [taskId]);
  const artifacts = all('SELECT * FROM task_artifacts WHERE task_id = ? AND deleted_at IS NULL', [taskId]);
  const refunds = all('SELECT * FROM credit_transactions WHERE related_task_id = ? AND type = ?', [taskId, 'refund']);
  const user = User.find(userId);
  const costLog = get('SELECT * FROM ai_cost_logs WHERE task_id = ? ORDER BY id DESC', [taskId]);
  const fakePlaceholder = JSON.stringify(artifacts).includes('Fake provider video placeholder');
  const videoArtifacts = artifacts.filter((artifact) => artifact.kind === 'video');
  const firstVideo = videoArtifacts[0] || null;
  const firstMeta = parseJson(firstVideo?.metadata_json);
  const checks = [
    check('task.exists', Boolean(task), 'Smoke task exists.'),
    check('task.requested_provider', task?.requested_provider === 'external', 'Task requested provider=external.', {
      requested_provider: task?.requested_provider,
    }),
    check('task.no_fake_placeholder', !fakePlaceholder, 'No fake video placeholder artifact was written.'),
  ];

  const outcome = task?.status === 'success' ? 'success' : task?.status === 'failed' ? 'failed' : task?.status || 'unknown';
  if (expected !== 'auto') {
    checks.push(check('task.expected_outcome', outcome === expected, `Expected task outcome=${expected}.`, { outcome }));
  }

  if (outcome === 'success') {
    checks.push(
      check('artifact.video', videoArtifacts.length > 0, 'A video artifact was created.', { artifact_count: videoArtifacts.length }),
      check('artifact.visibility', firstVideo?.visibility === 'private', 'Video artifact is private by default.', {
        visibility: firstVideo?.visibility,
      }),
      check('artifact.provider', firstMeta.provider === 'external' && firstMeta.source === 'external', 'Video artifact metadata marks provider/source=external.', firstMeta),
      check('cost.provider', costLog?.provider === 'external', 'AI cost log provider is external.', { provider: costLog?.provider }),
    );
  } else if (outcome === 'failed') {
    checks.push(
      check('task.error_code', task?.last_error_code === 'external_provider_failed', 'Task failed with external_provider_failed.', {
        error_code: task?.last_error_code,
      }),
      check('credit.refund', refunds.length > 0 && Number(refunds[0].amount) === Number(task?.credits_cost || 0), 'Failed task was refunded.', {
        refund_amount: refunds[0]?.amount,
        credits_cost: task?.credits_cost,
      }),
      check('credit.balance', Number(user?.credits_balance) === Number(startingBalance), 'Credit balance returned to starting balance.', {
        starting_balance: startingBalance,
        ending_balance: user?.credits_balance,
      }),
      check('artifact.none_on_failure', artifacts.length === 0, 'No artifact was written for failed external video task.', {
        artifact_count: artifacts.length,
      }),
    );
  } else {
    checks.push(check('task.terminal_status', false, 'Task did not reach success or failed.', { status: task?.status }));
  }

  return {
    ok: checks.every((item) => item.ok),
    outcome,
    task_id: taskId,
    status: task?.status || null,
    error_code: task?.last_error_code || null,
    artifact_count: artifacts.length,
    refund_count: refunds.length,
    db_path: dbPath,
    base_url: baseUrl,
    checks,
  };
}

function parseJson(value) {
  try {
    return typeof value === 'string' ? JSON.parse(value || '{}') : value || {};
  } catch {
    return {};
  }
}

