import { initDatabase, insert, get, now } from '../db/database.js';
import { migrate } from '../db/migrations.js';
import { seed, ensureAdmin } from '../db/seeders.js';
import { config } from '../config/index.js';
import { DevPilotHandoffClient, buildDevPilotIdempotencyKey } from '../clients/DevPilotHandoffClient.js';
import bcrypt from 'bcryptjs';

function redact(value) {
  return JSON.parse(JSON.stringify(value, (_key, item) => {
    if (typeof item !== 'string') return item;
    return item
      .replace(/sk-[A-Za-z0-9_-]{8,}/g, '[redacted_api_key]')
      .replace(/dev-key-[A-Za-z0-9_-]*/g, '[redacted_api_key]');
  }));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function ensureDemoTask(env = process.env) {
  await initDatabase();
  await migrate();
  await seed();
  const adminEmail = env.ADMIN_EMAIL || 'admin@example.com';
  const adminPassword = env.ADMIN_PASSWORD || 'password123';
  const adminId = ensureAdmin(adminEmail, await bcrypt.hash(adminPassword, 10), 'Admin');
  const existing = get('SELECT * FROM generation_tasks WHERE deleted_at IS NULL ORDER BY id DESC LIMIT 1');
  if (existing) return existing;
  const timestamp = now();
  const id = insert(
    `INSERT INTO generation_tasks
     (user_id, tool_type, status, product_name, main_title, language, image_size, logo_mode, quantity, credits_cost, failure_refunded, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [adminId, 'banner', 'pending', 'DevPilot Local Integration Product', 'Manual Handoff Check', 'zh-TW', '2K', 'keep', 1, 0, 0, timestamp, timestamp],
  );
  return get('SELECT * FROM generation_tasks WHERE id = ?', [id]);
}

function buildClient({ baseUrl, sourceSystem, apiKey, timeoutMs, fetchImpl }) {
  return new DevPilotHandoffClient({
    baseUrl,
    sourceSystem,
    apiKey,
    timeoutMs,
    fetchImpl,
  });
}

export async function runDevPilotLocalIntegration(env = process.env, options = {}) {
  const baseUrl = (env.DEVPILOT_API_BASE_URL || env.SMOKE_BASE_URL || config.appUrl || 'http://localhost:3000').replace(/\/+$/, '');
  const sourceA = env.DEVPILOT_SOURCE_SYSTEM || 'external-system-a';
  const sourceB = env.DEVPILOT_SECOND_SOURCE_SYSTEM || 'external-system-b';
  const keyA = env.DEVPILOT_API_KEY || 'dev-key-a';
  const keyB = env.DEVPILOT_SECOND_API_KEY || 'dev-key-b';
  const timeoutMs = Number(env.DEVPILOT_INTEGRATION_TIMEOUT_MS || 15_000);
  let task;
  if (env.DEVPILOT_TASK_ID) {
    try {
      task = get('SELECT * FROM generation_tasks WHERE id = ?', [Number(env.DEVPILOT_TASK_ID)]) || { id: Number(env.DEVPILOT_TASK_ID), status: 'unknown' };
    } catch {
      task = { id: Number(env.DEVPILOT_TASK_ID), status: 'unknown' };
    }
  } else {
    task = await ensureDemoTask(env);
  }
  const taskId = task.id;
  const sourceAClient = buildClient({ baseUrl, sourceSystem: sourceA, apiKey: keyA, timeoutMs, fetchImpl: options.fetchImpl });
  const sourceBClient = buildClient({ baseUrl, sourceSystem: sourceB, apiKey: keyB, timeoutMs, fetchImpl: options.fetchImpl });
  const externalRef = env.DEVPILOT_EXTERNAL_REF || `local-integration-${taskId}`;
  const idempotencyKey = env.DEVPILOT_IDEMPOTENCY_KEY || buildDevPilotIdempotencyKey({
    taskId,
    sourceSystem: sourceA,
    payload: { external_ref: externalRef },
  });

  const steps = [];
  const record = (step, data = {}) => steps.push(redact({ step, ...data }));

  const create = await sourceAClient.createHandoff(taskId, {
    from_agent: sourceA,
    to_agent: 'devpilot-reviewer',
    reason: 'RC1.12 local integration handoff check.',
    next_step: 'Verify external client/server contract before RC2.',
    risk: 'medium',
    external_ref: externalRef,
    actor_type: 'system',
    actor_id: sourceA,
  }, {
    requestId: env.DEVPILOT_REQUEST_ID || `local-request-${Date.now()}`,
    idempotencyKey,
  });
  assert(create.ok, 'Create handoff did not return ok=true.');
  assert(create.executionAllowed === false, 'Create handoff must return executionAllowed=false.');
  record('create handoff', { handoff_id: create.handoff?.handoff_id, idempotentReplay: create.idempotentReplay });

  const replay = await sourceAClient.createHandoff(taskId, {
    from_agent: sourceA,
    to_agent: 'devpilot-reviewer',
    reason: 'RC1.12 local integration handoff check.',
    next_step: 'Verify external client/server contract before RC2.',
    risk: 'medium',
    external_ref: externalRef,
    actor_type: 'system',
    actor_id: sourceA,
  }, {
    requestId: `local-replay-${Date.now()}`,
    idempotencyKey,
  });
  assert(replay.idempotentReplay === true, 'Replay must return idempotentReplay=true.');
  assert(replay.handoff?.handoff_id === create.handoff?.handoff_id, 'Replay returned a different handoff id.');
  record('idempotency replay', { handoff_id: replay.handoff?.handoff_id });

  const list = await sourceAClient.listHandoffs({ q: externalRef, status: 'pending', external_ref: externalRef });
  assert(list.ok === true, 'List handoffs did not return ok=true.');
  assert(list.handoffs?.some((handoff) => handoff.handoff_id === create.handoff?.handoff_id), 'List did not include created handoff.');
  record('list handoffs', { count: list.handoffs?.length || 0 });

  const detail = await sourceAClient.getHandoff(create.handoff.handoff_id);
  assert(detail.ok === true, 'Detail did not return ok=true.');
  assert(detail.handoff?.source_system === sourceA, 'Detail source_system mismatch.');
  assert(!JSON.stringify(detail).includes(keyA), 'Detail leaked source API key.');
  record('detail handoff', { handoff_id: detail.handoff?.handoff_id, source_system: detail.handoff?.source_system });

  let isolationStatus = null;
  try {
    await sourceBClient.getHandoff(create.handoff.handoff_id);
  } catch (error) {
    isolationStatus = error.status;
  }
  assert(isolationStatus === 404, 'Source isolation failed; another source could read the handoff.');
  record('source isolation', { other_source_status: isolationStatus });

  const summary = {
    ok: true,
    baseUrl,
    taskId,
    sourceSystem: sourceA,
    handoffId: create.handoff?.handoff_id,
    idempotentReplay: replay.idempotentReplay,
    listCount: list.handoffs?.length || 0,
    sourceIsolationStatus: isolationStatus,
    steps,
  };
  return redact(summary);
}
