import { createHash } from 'node:crypto';
import { all, insert, now } from '../db/database.js';
import { redactBase64 } from './AdminService.js';

const secretLike = /key|secret|token|password|authorization|api[_-]?key|hash/i;

export function redactAuditValue(value) {
  if (typeof value === 'string') {
    if (value.length > 240) return redactBase64(value);
    return value;
  }
  if (Array.isArray(value)) return value.map(redactAuditValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        secretLike.test(key) ? '[redacted]' : redactAuditValue(item),
      ]),
    );
  }
  return value;
}

function hashIp(ip = '') {
  const normalized = String(ip || '').trim();
  if (!normalized) return null;
  return createHash('sha256').update(normalized).digest('hex').slice(0, 16);
}

export function recordAuditLog({
  actorType = 'system',
  actorId = null,
  action,
  targetType = null,
  targetId = null,
  metadata = {},
  ip = '',
  userAgent = '',
} = {}) {
  if (!action) return null;
  return insert(
    `INSERT INTO audit_logs (actor_type, actor_id, action, target_type, target_id, metadata_safe, ip_hash, user_agent_safe, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      actorType,
      actorId === null || actorId === undefined ? null : String(actorId),
      action,
      targetType,
      targetId === null || targetId === undefined ? null : String(targetId),
      JSON.stringify(redactAuditValue(metadata || {})),
      hashIp(ip),
      String(userAgent || '').slice(0, 300),
      now(),
    ],
  );
}

export function listAuditLogs(query = {}) {
  const where = [];
  const params = [];
  if (query.action) {
    where.push('action = ?');
    params.push(query.action);
  }
  if (query.actor_id) {
    where.push('actor_id = ?');
    params.push(String(query.actor_id));
  }
  if (query.target_type) {
    where.push('target_type = ?');
    params.push(query.target_type);
  }
  if (query.start) {
    where.push('created_at >= ?');
    params.push(`${query.start}T00:00:00.000Z`);
  }
  if (query.end) {
    where.push('created_at <= ?');
    params.push(`${query.end}T23:59:59.999Z`);
  }
  const limit = Math.min(Math.max(Number(query.limit || 50), 1), 200);
  const offset = Math.max(Number(query.offset || 0), 0);
  const rows = all(
    `SELECT * FROM audit_logs ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY id DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  ).map((row) => ({
    ...row,
    metadata_safe: safeJson(row.metadata_safe),
  }));
  return { logs: rows, limit, offset };
}

function safeJson(value) {
  try {
    return JSON.parse(value || '{}');
  } catch {
    return {};
  }
}

export const auditService = {
  listAuditLogs,
  recordAuditLog,
  redactAuditValue,
};
