import { all, get, now, run } from '../db/database.js';
import { config } from '../config/index.js';
import { GenerationTask } from '../models/index.js';
import { storageUrl } from './StorageService.js';

const base64Like = /^[A-Za-z0-9+/=]{240,}$/;

function safeJsonParse(value, fallback = {}) {
  if (!value) return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

export function redactBase64(value) {
  if (typeof value === 'string') {
    if (value.length > 240 && (base64Like.test(value) || value.startsWith('data:image/'))) {
      return '[redacted_base64]';
    }
    return value.length > 1200 ? `${value.slice(0, 1200)}...[truncated]` : value;
  }
  if (Array.isArray(value)) return value.map((item) => redactBase64(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        ['b64_json', 'base64', 'image_base64'].includes(key) ? '[redacted_base64]' : redactBase64(item),
      ]),
    );
  }
  return value;
}

export function safeRawResponse(value) {
  return redactBase64(safeJsonParse(value, value || null));
}

export function parseCostLogMeta(log = null) {
  if (!log) {
    return {
      provider: null,
      model: null,
      image_mode: null,
      used_reference_image: false,
      storage_disk: null,
      image_count: 0,
      cost: null,
      latency_ms: null,
      fallback_used: false,
      fallback_reason: '',
      error_code: '',
      error_message: '',
      raw_response_json_safe: null,
    };
  }
  const raw = safeJsonParse(log.raw_response_json, {});
  return {
    provider: log.provider || raw.provider || null,
    model: log.model || raw.model || null,
    image_mode: raw.image_mode || null,
    used_reference_image: Boolean(raw.used_reference_image),
    storage_disk: raw.storage_disk || null,
    image_count: Number(log.image_count ?? raw.image_count ?? 0),
    cost: log.cost_usd ?? raw.cost ?? raw.estimated_cost ?? null,
    latency_ms: raw.latency_ms ?? null,
    fallback_used: Boolean(raw.fallback_used),
    fallback_reason: raw.fallback_reason || '',
    requested_provider: raw.requested_provider || '',
    resolved_provider: raw.resolved_provider || raw.provider || log.provider || '',
    requested_model: raw.requested_model || '',
    resolved_model: raw.resolved_model || raw.model || log.model || '',
    requested_capability: raw.requested_capability || '',
    provider_config_source: raw.provider_config_source || '',
    provider_selection_reason: raw.provider_selection_reason || '',
    quality_review_required: Boolean(raw.quality_review_required),
    error_code: raw.error_code || '',
    error_message: raw.error_message || raw.error || '',
    raw_response_json_safe: safeRawResponse(log.raw_response_json),
  };
}

function normalizeStatusFilter(status) {
  if (!status || status === 'all') return null;
  if (status === 'queued') return 'pending';
  if (status === 'completed') return 'success';
  return status;
}

function limitOffset(query) {
  const limit = Math.min(Math.max(Number(query.limit || 25), 1), 100);
  const offset = Math.max(Number(query.offset || 0), 0);
  return { limit, offset };
}

function taskListWhere(query = {}) {
  const params = [];
  const where = ['generation_tasks.deleted_at IS NULL'];
  const status = normalizeStatusFilter(query.status);
  if (status) {
    where.push('generation_tasks.status = ?');
    params.push(status);
  }
  if (query.provider && query.provider !== 'all') {
    where.push('(latest_log.provider = ? OR latest_log.raw_response_json LIKE ?)');
    params.push(query.provider, `%"provider":"${query.provider}"%`);
  }
  if (query.storage_disk && query.storage_disk !== 'all') {
    where.push('latest_log.raw_response_json LIKE ?');
    params.push(`%"storage_disk":"${query.storage_disk}"%`);
  }
  if (query.image_mode && query.image_mode !== 'all') {
    where.push('latest_log.raw_response_json LIKE ?');
    params.push(`%"image_mode":"${query.image_mode}"%`);
  }
  if (query.fallback === 'true' || query.fallback === '1') {
    where.push('latest_log.raw_response_json LIKE ?');
    params.push('%"fallback_used":true%');
  }
  if (query.q) {
    where.push('(CAST(generation_tasks.id AS TEXT) = ? OR users.email LIKE ?)');
    params.push(String(query.q), `%${query.q}%`);
  }
  return { where, params };
}

function latestLogJoin() {
  return `
    LEFT JOIN ai_cost_logs latest_log
      ON latest_log.id = (
        SELECT id FROM ai_cost_logs
        WHERE ai_cost_logs.task_id = generation_tasks.id
        ORDER BY id DESC
        LIMIT 1
      )
  `;
}

export function serializeAdminTaskRow(row) {
  const meta = parseCostLogMeta({
    provider: row.provider,
    model: row.model,
    image_count: row.image_count,
    cost_usd: row.cost_usd,
    raw_response_json: row.raw_response_json,
  });
  return {
    id: row.id,
    user_id: row.user_id,
    user_email: row.user_email,
    tool_type: row.tool_type,
    status: row.status,
    display_status: row.status === 'pending' ? 'queued' : row.status === 'success' ? 'completed' : row.status,
    provider: meta.provider,
    model: meta.model,
    image_mode: meta.image_mode,
    used_reference_image: meta.used_reference_image,
    storage_disk: meta.storage_disk,
    image_count: meta.image_count,
    cost: meta.cost,
    latency_ms: meta.latency_ms,
    fallback_used: meta.fallback_used,
    fallback_reason: meta.fallback_reason,
    error_code: meta.error_code || row.last_error_code || '',
    error_message: meta.error_message || row.last_error_message || row.error_message || '',
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function listAdminTasks(query = {}) {
  const { where, params } = taskListWhere(query);
  const { limit, offset } = limitOffset(query);
  const from = `
    FROM generation_tasks
    INNER JOIN users ON users.id = generation_tasks.user_id
    ${latestLogJoin()}
    WHERE ${where.join(' AND ')}
  `;
  const rows = all(
    `SELECT generation_tasks.*, users.email AS user_email,
            latest_log.provider, latest_log.model, latest_log.image_count,
            latest_log.cost_usd, latest_log.raw_response_json
     ${from}
     ORDER BY generation_tasks.created_at DESC, generation_tasks.id DESC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  ).map(serializeAdminTaskRow);
  const total = Number(get(`SELECT COUNT(*) AS count ${from}`, params)?.count || 0);
  return { tasks: rows, total, limit, offset };
}

export function getAdminTaskDetail(id) {
  const row = get(
    `SELECT generation_tasks.*, users.email AS user_email, users.name AS user_name, users.role AS user_role,
            users.credits_balance AS user_credits
     FROM generation_tasks
     INNER JOIN users ON users.id = generation_tasks.user_id
     WHERE generation_tasks.id = ? AND generation_tasks.deleted_at IS NULL`,
    [Number(id)],
  );
  if (!row) return null;
  const images = GenerationTask.images(row.id).map((image) => ({ ...image, url: storageUrl(image.storage_path) }));
  const logs = GenerationTask.costLogs(row.id).map((log) => ({
    ...log,
    metadata: parseCostLogMeta(log),
    raw_response_json_safe: safeRawResponse(log.raw_response_json),
  }));
  return {
    task: {
      ...row,
      request_payload_summary: {
        tool_type: row.tool_type,
        product_name: row.product_name,
        main_title: row.main_title,
        subtitle: row.subtitle,
        custom_prompt: row.custom_prompt ? `${String(row.custom_prompt).slice(0, 500)}` : null,
        style_key: row.style_key,
        text_mode: row.text_mode,
        language: row.language,
        image_size: row.image_size,
        quantity: row.quantity,
        credits_cost: row.credits_cost,
        requested_provider: row.requested_provider,
        resolved_provider: row.resolved_provider,
        requested_model: row.requested_model,
        resolved_model: row.resolved_model,
        requested_capability: row.requested_capability,
        quality_review_required: Boolean(row.quality_review_required),
      },
      metadata: logs[0]?.metadata || parseCostLogMeta(null),
    },
    user: {
      id: row.user_id,
      email: row.user_email,
      name: row.user_name,
      role: row.user_role,
      credits_balance: row.user_credits,
    },
    input_images: images.filter((image) => image.type === 'input'),
    output_images: images.filter((image) => image.type === 'output'),
    formats: GenerationTask.formats(row.id),
    ai_cost_logs: logs,
  };
}

export function listAdminUsers(query = {}) {
  const params = [];
  const where = [];
  if (query.q) {
    where.push('(users.email LIKE ? OR users.name LIKE ? OR CAST(users.id AS TEXT) = ?)');
    params.push(`%${query.q}%`, `%${query.q}%`, String(query.q));
  }
  if (query.role && query.role !== 'all') {
    where.push('users.role = ?');
    params.push(query.role);
  }
  if (query.status && query.status !== 'all') {
    where.push('users.status = ?');
    params.push(query.status);
  }
  const { limit, offset } = limitOffset(query);
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const users = all(
    `SELECT users.id, users.name, users.email, users.role, users.status, users.credits_balance,
            users.last_login_at, users.created_at, users.updated_at,
            (SELECT COUNT(*) FROM generation_tasks WHERE generation_tasks.user_id = users.id) AS task_count,
            (SELECT COUNT(*) FROM generation_tasks WHERE generation_tasks.user_id = users.id AND status = 'success') AS completed_task_count,
            (SELECT COUNT(*) FROM generation_tasks WHERE generation_tasks.user_id = users.id AND status = 'failed') AS failed_task_count
     FROM users
     ${whereSql}
     ORDER BY users.id DESC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );
  const total = Number(get(`SELECT COUNT(*) AS count FROM users ${whereSql}`, params)?.count || 0);
  return { users, total, limit, offset };
}

export function adminSummary() {
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  const today = dayStart.toISOString();
  const total = Number(get('SELECT COUNT(*) AS count FROM generation_tasks WHERE created_at >= ?', [today])?.count || 0);
  const success = Number(get("SELECT COUNT(*) AS count FROM generation_tasks WHERE created_at >= ? AND status = 'success'", [today])?.count || 0);
  const failed = Number(get("SELECT COUNT(*) AS count FROM generation_tasks WHERE created_at >= ? AND status = 'failed'", [today])?.count || 0);
  const logs = all('SELECT * FROM ai_cost_logs WHERE created_at >= ?', [today]);
  const metas = logs.map(parseCostLogMeta);
  const fallbackCount = metas.filter((meta) => meta.fallback_used).length;
  const latencyValues = metas.map((meta) => Number(meta.latency_ms)).filter((value) => Number.isFinite(value));
  const estimatedCostTotal = metas.reduce((sum, meta) => sum + Number(meta.cost || 0), 0);
  const providerCounts = metas.reduce(
    (acc, meta) => {
      if (meta.provider === 'openai') acc.openai += 1;
      if (meta.provider === 'fake') acc.fake += 1;
      return acc;
    },
    { fake: 0, openai: 0 },
  );
  const storageCounts = metas.reduce((acc, meta) => {
    const disk = meta.storage_disk || 'unknown';
    acc[disk] = (acc[disk] || 0) + 1;
    return acc;
  }, {});
  return {
    stats: {
      todayTasks: total,
      todaySuccess: success,
      todayFailed: failed,
      todayFallbacks: fallbackCount,
      estimatedCostTotal: Number(estimatedCostTotal.toFixed(6)),
      averageLatency: latencyValues.length
        ? Math.round(latencyValues.reduce((sum, value) => sum + value, 0) / latencyValues.length)
        : 0,
      fakeProviderTasks: providerCounts.fake,
      openaiProviderTasks: providerCounts.openai,
      failedRate: total ? Number((failed / total).toFixed(4)) : 0,
      fallbackRate: total ? Number((fallbackCount / total).toFixed(4)) : 0,
    },
    recentFailedTasks: failedTasks({ limit: 8 }).tasks,
    recentOutputs: all(
      `SELECT task_images.*, generation_tasks.product_name, generation_tasks.main_title
       FROM task_images
       INNER JOIN generation_tasks ON generation_tasks.id = task_images.task_id
       WHERE task_images.type = 'output' AND task_images.deleted_at IS NULL
       ORDER BY task_images.id DESC LIMIT 8`,
    ).map((image) => ({ ...image, url: storageUrl(image.storage_path) })),
    storageSplit: Object.entries(storageCounts).map(([storage_disk, count]) => ({ storage_disk, count })),
  };
}

export function failedTasks(query = {}) {
  return listAdminTasks({ ...query, status: 'failed' });
}

export function adminStorageSummary() {
  return {
    disk: config.filesystemDisk,
    storagePublicUrlMasked: maskUrl(config.storagePublicUrl || ''),
    local: {
      uploadDir: config.uploadDir,
      outputDir: config.outputDir,
    },
    r2: {
      accountId: maskValue(config.r2.accountId),
      bucket: config.r2.bucket || '',
      endpoint: config.r2.accountId ? `https://${config.r2.accountId}.r2.cloudflarestorage.com` : '',
      accessKeyConfigured: Boolean(config.r2.accessKeyId),
      secretConfigured: Boolean(config.r2.secretAccessKey),
    },
    s3: {
      endpoint: config.s3.endpoint || '',
      region: config.s3.region || '',
      bucket: config.s3.bucket || '',
      accessKeyConfigured: Boolean(config.s3.accessKeyId),
      secretConfigured: Boolean(config.s3.secretAccessKey),
    },
    warnings: [
      ['r2', 's3'].includes(config.filesystemDisk) && !config.storagePublicUrl ? 'STORAGE_PUBLIC_URL is not configured.' : '',
    ].filter(Boolean),
  };
}

export function diagnosticSummary(id) {
  const detail = getAdminTaskDetail(id);
  if (!detail) return null;
  const meta = detail.task.metadata || {};
  return redactBase64({
    task_id: detail.task.id,
    provider: meta.provider,
    model: meta.model,
    image_mode: meta.image_mode,
    storage_disk: meta.storage_disk,
    fallback_used: meta.fallback_used,
    fallback_reason: meta.fallback_reason,
    error_code: meta.error_code || detail.task.last_error_code,
    error_message: meta.error_message || detail.task.error_message,
    suggestions: diagnosticSuggestions(meta, detail.task),
  });
}

export function exportTasksCsv(query = {}) {
  const rows = listAdminTasks({ ...query, limit: 1000, offset: 0 }).tasks;
  const columns = ['id', 'user_email', 'status', 'provider', 'model', 'image_mode', 'storage_disk', 'fallback_used', 'fallback_reason', 'error_code', 'created_at'];
  return [
    columns.join(','),
    ...rows.map((row) => columns.map((column) => csvCell(row[column])).join(',')),
  ].join('\n');
}

export function bulkTaskAction({ ids = [], action, adminUserId }) {
  const cleanIds = ids.map(Number).filter(Boolean);
  if (!cleanIds.length) return { updated: 0, ids: [] };
  cleanIds.forEach((id) => {
    if (action === 'mark_reviewed') {
      const detail = getAdminTaskDetail(id);
      const log = detail?.ai_cost_logs?.[0];
      if (detail && log) {
        const meta = safeRawResponse(log.raw_response_json) || {};
        meta.admin_reviewed = true;
        meta.admin_reviewed_by = adminUserId;
        meta.admin_reviewed_at = now();
        run('UPDATE ai_cost_logs SET raw_response_json = ?, updated_at = ? WHERE id = ?', [
          JSON.stringify(redactBase64(meta)),
          now(),
          log.id,
        ]);
      }
    }
    if (action === 'retry_failed') {
      const task = GenerationTask.find(id);
      if (task?.status === 'failed') {
        GenerationTask.update(id, { status: 'pending', error_message: null, started_at: null, finished_at: null });
      }
    }
  });
  return { updated: cleanIds.length, ids: cleanIds, action };
}

export function upsertQualityReview({ taskId, taskImageId = null, reviewerUserId, body = {} }) {
  const existing = get('SELECT * FROM quality_reviews WHERE task_id = ? AND COALESCE(task_image_id, 0) = COALESCE(?, 0)', [
    Number(taskId),
    taskImageId ? Number(taskImageId) : null,
  ]);
  const values = [
    body.product_preserved || null,
    body.no_garbled_text || null,
    body.composition_ok || null,
    body.size_ok || null,
    body.commercial_quality ? Number(body.commercial_quality) : null,
    body.notes ? String(redactBase64(body.notes)).slice(0, 1000) : null,
    body.approved === true || body.approved === 'true' || body.approved === 1 || body.approved === '1' ? 1 : 0,
    body.needs_regeneration === true || body.needs_regeneration === 'true' || body.needs_regeneration === 1 || body.needs_regeneration === '1' ? 1 : 0,
    body.regeneration_reason ? String(redactBase64(body.regeneration_reason)).slice(0, 1000) : null,
    now(),
  ];
  if (existing) {
    run(
      `UPDATE quality_reviews SET product_preserved = ?, no_garbled_text = ?, composition_ok = ?, size_ok = ?,
       commercial_quality = ?, notes = ?, approved = ?, needs_regeneration = ?, regeneration_reason = ?, updated_at = ? WHERE id = ?`,
      [...values, existing.id],
    );
    return get('SELECT * FROM quality_reviews WHERE id = ?', [existing.id]);
  }
  run(
    `INSERT INTO quality_reviews
     (task_id, task_image_id, reviewer_user_id, product_preserved, no_garbled_text, composition_ok, size_ok, commercial_quality, notes, approved, needs_regeneration, regeneration_reason, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      Number(taskId),
      taskImageId ? Number(taskImageId) : null,
      Number(reviewerUserId),
      body.product_preserved || null,
      body.no_garbled_text || null,
      body.composition_ok || null,
      body.size_ok || null,
      body.commercial_quality ? Number(body.commercial_quality) : null,
      body.notes ? String(redactBase64(body.notes)).slice(0, 1000) : null,
      body.approved === true || body.approved === 'true' || body.approved === 1 || body.approved === '1' ? 1 : 0,
      body.needs_regeneration === true || body.needs_regeneration === 'true' || body.needs_regeneration === 1 || body.needs_regeneration === '1' ? 1 : 0,
      body.regeneration_reason ? String(redactBase64(body.regeneration_reason)).slice(0, 1000) : null,
      now(),
      now(),
    ],
  );
  return get('SELECT * FROM quality_reviews WHERE task_id = ? AND COALESCE(task_image_id, 0) = COALESCE(?, 0)', [
    Number(taskId),
    taskImageId ? Number(taskImageId) : null,
  ]);
}

export function listQualityReviews(query = {}) {
  const { limit, offset } = limitOffset(query);
  const where = [];
  const params = [];
  if (query.status === 'approved') where.push('quality_reviews.approved = 1');
  if (query.status === 'needs_regeneration') where.push('quality_reviews.needs_regeneration = 1');
  if (query.status === 'pending') where.push('COALESCE(quality_reviews.approved, 0) = 0 AND COALESCE(quality_reviews.needs_regeneration, 0) = 0');
  return {
    reviews: all(
      `SELECT quality_reviews.*, generation_tasks.product_name, generation_tasks.main_title, task_images.storage_path
       FROM quality_reviews
       INNER JOIN generation_tasks ON generation_tasks.id = quality_reviews.task_id
       LEFT JOIN task_images ON task_images.id = quality_reviews.task_image_id
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY quality_reviews.id DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    ).map((row) => ({ ...row, url: row.storage_path ? storageUrl(row.storage_path) : null })),
    recentTasks: listAdminTasks({ limit: 10 }).tasks,
    limit,
    offset,
  };
}

function csvCell(value) {
  const text = String(value ?? '').replaceAll('"', '""');
  return `"${text}"`;
}

function maskValue(value) {
  const text = String(value || '');
  if (!text) return '';
  if (text.length <= 6) return '***';
  return `${text.slice(0, 3)}...${text.slice(-3)}`;
}

function maskUrl(value) {
  if (!value) return '';
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`;
  } catch {
    return maskValue(value);
  }
}

function diagnosticSuggestions(meta, task) {
  if (task.status === 'processing') return ['Check worker process and queue mode.', 'Run smoke:staging if polling does not advance.'];
  if (task.status === 'failed') return ['Check provider config and task error.', 'Run storage:check when output URLs fail.'];
  if (meta.fallback_used) return ['Review fallback_reason before RC2 true API acceptance.'];
  return ['No immediate diagnostic action required.'];
}
