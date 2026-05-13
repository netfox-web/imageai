import { createHash, timingSafeEqual } from 'node:crypto';
import { all, get, now, run } from '../db/database.js';

function normalizeSource(sourceSystem) {
  return String(sourceSystem || '').trim();
}

export function hashDevPilotApiKey(apiKey) {
  return `sha256:${createHash('sha256').update(String(apiKey || ''), 'utf8').digest('hex')}`;
}

export function fingerprintDevPilotApiKey(apiKey) {
  return createHash('sha256').update(String(apiKey || ''), 'utf8').digest('hex').slice(0, 12);
}

function safeHashEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ''));
  const rightBuffer = Buffer.from(String(right || ''));
  if (leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}

function safeKeyRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    source_system: row.source_system,
    label: row.label || '',
    key_fingerprint: row.key_fingerprint,
    status: row.status,
    created_by_user_id: row.created_by_user_id || null,
    last_used_at: row.last_used_at || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function listDevPilotExternalKeys() {
  return all(
    `SELECT id, source_system, label, key_fingerprint, status, created_by_user_id, last_used_at, created_at, updated_at
     FROM devpilot_external_api_keys
     ORDER BY updated_at DESC, id DESC`,
  ).map(safeKeyRow);
}

export function countActiveDevPilotExternalKeys() {
  try {
    return Number(get("SELECT COUNT(*) AS count FROM devpilot_external_api_keys WHERE status = 'active'")?.count || 0);
  } catch {
    return 0;
  }
}

export function saveDevPilotExternalKey({ sourceSystem, apiKey, label = '', adminUserId = null }) {
  const source = normalizeSource(sourceSystem);
  const key = String(apiKey || '');
  if (!source) throw validationError('source_system is required.');
  if (!key) throw validationError('api_key is required.');
  if (source.length > 120) throw validationError('source_system is too long.');
  if (key.length < 16) throw validationError('api_key is too short.');

  const timestamp = now();
  const existing = get('SELECT id FROM devpilot_external_api_keys WHERE source_system = ?', [source]);
  const keyHash = hashDevPilotApiKey(key);
  const fingerprint = fingerprintDevPilotApiKey(key);
  if (existing) {
    run(
      `UPDATE devpilot_external_api_keys
       SET label = ?, key_hash = ?, key_fingerprint = ?, status = 'active', created_by_user_id = ?, updated_at = ?
       WHERE id = ?`,
      [label || null, keyHash, fingerprint, adminUserId ? Number(adminUserId) : null, timestamp, existing.id],
    );
    return safeKeyRow(get('SELECT * FROM devpilot_external_api_keys WHERE id = ?', [existing.id]));
  }

  run(
    `INSERT INTO devpilot_external_api_keys
     (source_system, label, key_hash, key_fingerprint, status, created_by_user_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'active', ?, ?, ?)`,
    [source, label || null, keyHash, fingerprint, adminUserId ? Number(adminUserId) : null, timestamp, timestamp],
  );
  return safeKeyRow(get('SELECT * FROM devpilot_external_api_keys WHERE source_system = ?', [source]));
}

export function revokeDevPilotExternalKey(id) {
  const existing = get('SELECT * FROM devpilot_external_api_keys WHERE id = ?', [Number(id)]);
  if (!existing) throw validationError('DevPilot key not found.', 404);
  run("UPDATE devpilot_external_api_keys SET status = 'revoked', updated_at = ? WHERE id = ?", [now(), existing.id]);
  return safeKeyRow(get('SELECT * FROM devpilot_external_api_keys WHERE id = ?', [existing.id]));
}

export function verifyDevPilotExternalKey(sourceSystem, apiKey) {
  const source = normalizeSource(sourceSystem);
  if (!source || !apiKey) return { matched: false, sourceExists: false };
  let rows = [];
  try {
    rows = all(
      `SELECT id, source_system, key_hash
       FROM devpilot_external_api_keys
       WHERE source_system = ? AND status = 'active'`,
      [source],
    );
  } catch {
    return { matched: false, sourceExists: false };
  }
  const candidateHash = hashDevPilotApiKey(apiKey);
  const match = rows.find((row) => safeHashEqual(candidateHash, row.key_hash));
  return { matched: Boolean(match), sourceExists: rows.length > 0, sourceSystem: source };
}

function validationError(message, status = 422) {
  const error = new Error(message);
  error.status = status;
  return error;
}

export const devPilotExternalKeyService = {
  countActiveDevPilotExternalKeys,
  fingerprintDevPilotApiKey,
  hashDevPilotApiKey,
  listDevPilotExternalKeys,
  revokeDevPilotExternalKey,
  saveDevPilotExternalKey,
  verifyDevPilotExternalKey,
};
