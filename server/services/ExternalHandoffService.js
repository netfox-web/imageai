import { all, get, insert, now } from '../db/database.js';
import { GenerationTask } from '../models/index.js';
import { ExternalApiError } from './ExternalApiAuthService.js';

const base64Like = /^[A-Za-z0-9+/=]{240,}$/;
const secretKeyPattern = /(api[_-]?key|secret|token|password|authorization|credential)/i;

function safeJsonParse(value, fallback = {}) {
  if (!value) return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

export function redactExternalValue(value) {
  if (typeof value === 'string') {
    if (value.length > 240 && (base64Like.test(value) || value.startsWith('data:image/'))) {
      return '[redacted_base64]';
    }
    return value.length > 1000 ? `${value.slice(0, 1000)}...[truncated]` : value;
  }
  if (Array.isArray(value)) return value.map((item) => redactExternalValue(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        secretKeyPattern.test(key) ? '[redacted_secret]' : redactExternalValue(item),
      ]),
    );
  }
  return value;
}

function requiredText(body, key) {
  const value = String(body?.[key] || '').trim();
  if (!value) throw new ExternalApiError(`Missing required field: ${key}`, 400);
  return value;
}

function normalizeRisk(body) {
  const risk = String(body?.risk_level || body?.risk || '').trim();
  if (!risk) throw new ExternalApiError('Missing required field: risk_level or risk', 400);
  return risk;
}

function taskTitle(task) {
  return task.product_name || task.main_title || task.custom_prompt || `Task #${task.id}`;
}

function safePayloadSummary({ auth, body, taskId, risk }) {
  return redactExternalValue({
    source_system: auth.sourceSystem,
    request_id: auth.requestId,
    idempotency_key: auth.idempotencyKey,
    external_ref: body.external_ref || null,
    actor_type: body.actor_type || null,
    actor_id: body.actor_id || null,
    task_id: Number(taskId),
    risk,
    request_fields: Object.keys(body || {}).filter((key) => !secretKeyPattern.test(key)).sort(),
  });
}

function readPayload(row) {
  return safeJsonParse(row?.api_payload, {});
}

function canReadSource(row, auth, query = {}) {
  if (auth.allowAllSources && String(query.include_all_sources || '').toLowerCase() === 'true') return true;
  const payload = readPayload(row);
  return (row.source_system || payload.source_system) === auth.sourceSystem;
}

export function serializeHandoff(row, auth = null) {
  if (!row) return null;
  const payload = readPayload(row);
  const task = row.task_title !== undefined
    ? row
    : get('SELECT id, product_name, main_title, custom_prompt FROM generation_tasks WHERE id = ?', [Number(row.task_id)]);
  const safeSummary = redactExternalValue({
    source_system: row.source_system || payload.source_system || null,
    external_ref: row.external_ref || payload.external_ref || null,
    request_id: row.request_id || payload.request_id || null,
    idempotency_key: row.idempotency_key || payload.idempotency_key || null,
    actor_type: row.actor_type || payload.actor_type || null,
    actor_id: row.actor_id || payload.actor_id || null,
    request_fields: payload.request_fields || [],
  });
  return {
    handoff_id: row.id,
    conversation_ref: row.conversation_ref,
    task_id: row.task_id,
    task_title: row.task_title || (task ? taskTitle(task) : `Task #${row.task_id}`),
    project_id: row.project_id || null,
    project_name: row.project_name || null,
    project_status: row.project_status || null,
    source_system: row.source_system || payload.source_system || null,
    external_ref: row.external_ref || payload.external_ref || null,
    request_id: row.request_id || payload.request_id || null,
    idempotency_key: row.idempotency_key || payload.idempotency_key || null,
    actor_type: row.actor_type || payload.actor_type || null,
    actor_id: row.actor_id || payload.actor_id || null,
    from_agent: row.from_agent,
    to_agent: row.to_agent,
    status: row.status,
    risk: row.risk,
    reason: row.reason,
    next_step: row.next_step,
    rejection_reason: row.rejection_reason || null,
    execution_allowed: Boolean(row.execution_allowed),
    created_at: row.created_at,
    updated_at: row.updated_at,
    deleted_at: row.deleted_at || null,
    api_payload_summary: safeSummary,
    ...(auth ? { authenticated_source: auth.sourceSystem } : {}),
  };
}

function findIdempotentHandoff({ taskId, auth }) {
  if (!auth.idempotencyKey) return null;
  const conversationRef = `ai-task:${Number(taskId)}`;
  const rows = all(
    `SELECT * FROM ai_handoff_logs
     WHERE conversation_ref = ? AND hidden = 0 AND deleted_at IS NULL
     ORDER BY id DESC`,
    [conversationRef],
  );
  return rows.find((row) => {
    const payload = readPayload(row);
    return payload.source_system === auth.sourceSystem && payload.idempotency_key === auth.idempotencyKey;
  }) || null;
}

export function createExternalHandoff({ taskId, body = {}, auth }) {
  const task = GenerationTask.find(taskId);
  if (!task) throw new ExternalApiError('Task not found.', 404);

  const fromAgent = requiredText(body, 'from_agent');
  const toAgent = requiredText(body, 'to_agent');
  const reason = requiredText(body, 'reason');
  const nextStep = requiredText(body, 'next_step');
  const risk = normalizeRisk(body);

  const existing = findIdempotentHandoff({ taskId, auth });
  if (existing) {
    return {
      handoff: serializeHandoff(existing, auth),
      idempotent_replay: true,
      execution_allowed: false,
      statusCode: 200,
    };
  }

  const timestamp = now();
  const payload = safePayloadSummary({ auth, body, taskId, risk });
  const id = insert(
    `INSERT INTO ai_handoff_logs
     (conversation_ref, task_id, project_id, project_name, project_status, source_system, external_ref,
      request_id, idempotency_key, actor_type, actor_id, from_agent, to_agent, status, risk, reason,
      next_step, rejection_reason, execution_allowed, api_payload, hidden, created_at, updated_at, deleted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      `ai-task:${Number(taskId)}`,
      Number(taskId),
      body.project_id || null,
      body.project_name || null,
      body.project_status || null,
      auth.sourceSystem,
      body.external_ref || null,
      auth.requestId,
      auth.idempotencyKey,
      body.actor_type || null,
      body.actor_id || null,
      fromAgent,
      toAgent,
      'pending',
      risk,
      reason,
      nextStep,
      null,
      0,
      JSON.stringify(payload),
      0,
      timestamp,
      timestamp,
      null,
    ],
  );
  return {
    handoff: serializeHandoff(get('SELECT * FROM ai_handoff_logs WHERE id = ?', [id]), auth),
    idempotent_replay: false,
    execution_allowed: false,
    statusCode: 201,
  };
}

function listWhere(query, auth) {
  const where = ['ai_handoff_logs.hidden = 0', 'ai_handoff_logs.deleted_at IS NULL'];
  const params = [];
  const includeAll = auth.allowAllSources && String(query.include_all_sources || '').toLowerCase() === 'true';
  const source = includeAll ? query.source_system : auth.sourceSystem;
  if (source) {
    where.push('ai_handoff_logs.source_system = ?');
    params.push(source);
  }
  [
    ['from_agent', 'ai_handoff_logs.from_agent'],
    ['to_agent', 'ai_handoff_logs.to_agent'],
    ['status', 'ai_handoff_logs.status'],
    ['external_ref', 'ai_handoff_logs.external_ref'],
  ].forEach(([key, column]) => {
    if (query[key]) {
      where.push(`${column} = ?`);
      params.push(String(query[key]));
    }
  });
  const risk = query.risk_level || query.risk;
  if (risk) {
    where.push('ai_handoff_logs.risk = ?');
    params.push(String(risk));
  }
  if (query.q) {
    where.push('(CAST(ai_handoff_logs.id AS TEXT) = ? OR CAST(ai_handoff_logs.task_id AS TEXT) = ? OR ai_handoff_logs.reason LIKE ? OR ai_handoff_logs.next_step LIKE ? OR ai_handoff_logs.external_ref LIKE ? OR generation_tasks.product_name LIKE ? OR generation_tasks.main_title LIKE ?)');
    const like = `%${query.q}%`;
    params.push(String(query.q), String(query.q), like, like, like, like, like);
  }
  return { where, params };
}

export function listExternalHandoffs({ query = {}, auth }) {
  const limit = Math.min(Number(query.limit || 50), 100);
  const offset = Math.max(Number(query.offset || 0), 0);
  const { where, params } = listWhere(query, auth);
  const rows = all(
    `SELECT ai_handoff_logs.*, generation_tasks.product_name, generation_tasks.main_title, generation_tasks.custom_prompt,
            COALESCE(generation_tasks.product_name, generation_tasks.main_title, generation_tasks.custom_prompt) AS task_title
     FROM ai_handoff_logs
     INNER JOIN generation_tasks ON generation_tasks.id = ai_handoff_logs.task_id
     WHERE ${where.join(' AND ')}
     ORDER BY ai_handoff_logs.id DESC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );
  const total = Number(get(
    `SELECT COUNT(*) AS count
     FROM ai_handoff_logs
     INNER JOIN generation_tasks ON generation_tasks.id = ai_handoff_logs.task_id
     WHERE ${where.join(' AND ')}`,
    params,
  )?.count || 0);
  return { handoffs: rows.map((row) => serializeHandoff(row, auth)), total, limit, offset };
}

export function getExternalHandoff({ handoffId, query = {}, auth }) {
  const row = get(
    `SELECT ai_handoff_logs.*, generation_tasks.product_name, generation_tasks.main_title, generation_tasks.custom_prompt,
            COALESCE(generation_tasks.product_name, generation_tasks.main_title, generation_tasks.custom_prompt) AS task_title
     FROM ai_handoff_logs
     INNER JOIN generation_tasks ON generation_tasks.id = ai_handoff_logs.task_id
     WHERE ai_handoff_logs.id = ? AND ai_handoff_logs.hidden = 0 AND ai_handoff_logs.deleted_at IS NULL`,
    [Number(handoffId)],
  );
  if (!row || !canReadSource(row, auth, query)) throw new ExternalApiError('Handoff not found.', 404);
  return serializeHandoff(row, auth);
}

export const externalHandoffService = {
  createExternalHandoff,
  listExternalHandoffs,
  getExternalHandoff,
};

