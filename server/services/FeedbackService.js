import { all, get, insert, now, run } from '../db/database.js';
import { recordAuditLog } from './AuditService.js';

const typeValues = new Set(['bug', 'quality', 'billing', 'account', 'other']);
const severityValues = new Set(['low', 'medium', 'high']);
const statusValues = new Set(['open', 'reviewing', 'resolved', 'ignored']);
const secretPattern = /(sk-[A-Za-z0-9_-]{8,}|AIza[0-9A-Za-z_-]{20,}|api[_-]?key\s*[:=]\s*[^,\s]+|password\s*[:=]\s*[^,\s]+)/gi;
const base64Pattern = /[A-Za-z0-9+/=]{240,}/g;

export function createFeedbackReport({ user = null, body = {}, req = null } = {}) {
  const title = sanitizeText(body.title, 160);
  const description = sanitizeText(body.description, 3000);
  if (!title) throw httpError('Feedback title is required.', 422);
  if (!description) throw httpError('Feedback description is required.', 422);

  const type = typeValues.has(body.type) ? body.type : 'other';
  const severity = severityValues.has(body.severity) ? body.severity : 'medium';
  const taskId = body.task_id ? Number(body.task_id) : null;
  if (taskId && !Number.isFinite(taskId)) throw httpError('Task id is invalid.', 422);
  const assetUrl = sanitizeUrlLike(body.asset_url, 800);
  const screenshotUrl = sanitizeUrlLike(body.screenshot_url, 800);
  const browserInfo = sanitizeText(body.browser_info || req?.get?.('user-agent') || '', 1000);
  const timestamp = now();
  const id = insert(
    `INSERT INTO feedback_reports
      (user_id, task_id, asset_url, type, severity, title, description, browser_info_safe, screenshot_url, status, admin_notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      user?.id || null,
      taskId || null,
      assetUrl || null,
      type,
      severity,
      title,
      description,
      browserInfo || null,
      screenshotUrl || null,
      'open',
      null,
      timestamp,
      timestamp,
    ],
  );
  recordAuditLog({
    actorType: user ? 'user' : 'anonymous',
    actorId: user?.id || null,
    action: 'feedback_create',
    targetType: 'feedback_report',
    targetId: id,
    metadata: { type, severity, task_id: taskId || null },
    ip: req?.ip,
    userAgent: req?.get?.('user-agent'),
  });
  return serializeFeedback(getFeedbackReport(id, { admin: true }));
}

export function listFeedbackReports({ query = {}, admin = false, user = null } = {}) {
  const where = [];
  const params = [];
  if (!admin) {
    where.push('feedback_reports.user_id = ?');
    params.push(Number(user?.id || 0));
  }
  if (query.status && statusValues.has(query.status)) {
    where.push('feedback_reports.status = ?');
    params.push(query.status);
  }
  if (query.type && typeValues.has(query.type)) {
    where.push('feedback_reports.type = ?');
    params.push(query.type);
  }
  if (query.q) {
    where.push('(feedback_reports.title LIKE ? OR feedback_reports.description LIKE ? OR CAST(feedback_reports.id AS TEXT) = ? OR CAST(feedback_reports.task_id AS TEXT) = ?)');
    params.push(`%${query.q}%`, `%${query.q}%`, String(query.q), String(query.q));
  }
  const limit = Math.min(Number(query.limit || 50), 100);
  const offset = Math.max(Number(query.offset || 0), 0);
  const sqlWhere = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const rows = all(
    `SELECT feedback_reports.*, users.email AS user_email
     FROM feedback_reports
     LEFT JOIN users ON users.id = feedback_reports.user_id
     ${sqlWhere}
     ORDER BY feedback_reports.id DESC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  ).map((row) => serializeFeedback(row, { admin }));
  const total = Number(get(`SELECT COUNT(*) AS count FROM feedback_reports ${sqlWhere}`, params)?.count || 0);
  return { reports: rows, total, limit, offset };
}

export function getFeedbackReport(id, { admin = false, user = null } = {}) {
  const row = get(
    `SELECT feedback_reports.*, users.email AS user_email
     FROM feedback_reports
     LEFT JOIN users ON users.id = feedback_reports.user_id
     WHERE feedback_reports.id = ?`,
    [Number(id)],
  );
  if (!row) throw httpError('Feedback report not found.', 404);
  if (!admin && row.user_id !== user?.id) throw httpError('Forbidden.', 403);
  return serializeFeedback(row, { admin });
}

export function updateFeedbackReport({ id, body = {}, adminUser = null, req = null } = {}) {
  const existing = getFeedbackReport(id, { admin: true });
  const status = statusValues.has(body.status) ? body.status : existing.status;
  const adminNotes = body.admin_notes === undefined ? existing.admin_notes : sanitizeText(body.admin_notes, 3000);
  run('UPDATE feedback_reports SET status = ?, admin_notes = ?, updated_at = ? WHERE id = ?', [
    status,
    adminNotes || null,
    now(),
    Number(id),
  ]);
  recordAuditLog({
    actorType: 'admin',
    actorId: adminUser?.id || null,
    action: 'feedback_update',
    targetType: 'feedback_report',
    targetId: id,
    metadata: { status },
    ip: req?.ip,
    userAgent: req?.get?.('user-agent'),
  });
  return getFeedbackReport(id, { admin: true });
}

export function feedbackCounts() {
  return {
    open: Number(get("SELECT COUNT(*) AS count FROM feedback_reports WHERE status = 'open'")?.count || 0),
    total: Number(get('SELECT COUNT(*) AS count FROM feedback_reports')?.count || 0),
  };
}

export function sanitizeText(value, maxLength = 1000) {
  return String(value || '')
    .replace(secretPattern, '[redacted_secret]')
    .replace(base64Pattern, '[redacted_base64]')
    .slice(0, maxLength)
    .trim();
}

function sanitizeUrlLike(value, maxLength) {
  const text = sanitizeText(value, maxLength);
  if (!text) return '';
  if (text.startsWith('/') || /^https?:\/\//i.test(text)) return text;
  return '';
}

function serializeFeedback(row, { admin = true } = {}) {
  if (!row) return null;
  const safe = {
    id: row.id,
    user_id: row.user_id || null,
    task_id: row.task_id || null,
    asset_url: row.asset_url || null,
    type: row.type,
    severity: row.severity,
    title: sanitizeText(row.title, 200),
    description: sanitizeText(row.description, 3000),
    browser_info_safe: sanitizeText(row.browser_info_safe, 1000),
    screenshot_url: row.screenshot_url || null,
    status: row.status,
    admin_notes: admin ? sanitizeText(row.admin_notes, 3000) : null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
  if (admin) safe.user_email = row.user_email || null;
  return safe;
}

function httpError(message, status = 422) {
  const error = new Error(message);
  error.status = status;
  return error;
}
