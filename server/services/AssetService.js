import { all, get, now, run } from '../db/database.js';
import { config } from '../config/index.js';
import { storageUrl } from './StorageService.js';
import { parseCostLogMeta } from './AdminService.js';
import { recordAuditLog } from './AuditService.js';

function limitOffset(query = {}, fallbackLimit = 60) {
  return {
    limit: Math.min(Math.max(Number(query.limit || fallbackLimit), 1), 100),
    offset: Math.max(Number(query.offset || 0), 0),
  };
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

function assetWhere({ user, query = {}, admin = false }) {
  const where = ['task_images.deleted_at IS NULL'];
  const params = [];
  if (!admin) {
    where.push('generation_tasks.user_id = ?');
    params.push(Number(user.id));
  }
  if (query.type && query.type !== 'all') {
    where.push('task_images.type = ?');
    params.push(query.type);
  }
  if (query.provider && query.provider !== 'all') {
    where.push('(latest_log.provider = ? OR latest_log.raw_response_json LIKE ?)');
    params.push(query.provider, `%"provider":"${query.provider}"%`);
  }
  if (query.format && query.format !== 'all') {
    where.push('(platform_formats.platform_key = ? OR platform_formats.format_name LIKE ?)');
    params.push(query.format, `%${query.format}%`);
  }
  if (query.start) {
    where.push('task_images.created_at >= ?');
    params.push(`${query.start}T00:00:00.000Z`);
  }
  if (query.end) {
    where.push('task_images.created_at <= ?');
    params.push(`${query.end}T23:59:59.999Z`);
  }
  if (query.q) {
    where.push('(CAST(generation_tasks.id AS TEXT) = ? OR generation_tasks.product_name LIKE ? OR generation_tasks.main_title LIKE ? OR ai_handoff_logs.external_ref LIKE ?)');
    params.push(String(query.q), `%${query.q}%`, `%${query.q}%`, `%${query.q}%`);
  }
  if (query.archived !== '1' && query.archived !== 'true') {
    where.push('COALESCE(asset_metadata.archived, 0) = 0');
  }
  return { where, params };
}

export function listAssets({ user, query = {}, admin = false } = {}) {
  const { limit, offset } = limitOffset(query);
  const { where, params } = assetWhere({ user, query, admin });
  const from = `
    FROM task_images
    INNER JOIN generation_tasks ON generation_tasks.id = task_images.task_id
    LEFT JOIN task_formats ON task_formats.task_id = generation_tasks.id
    LEFT JOIN platform_formats ON platform_formats.id = task_formats.platform_format_id
    LEFT JOIN asset_metadata ON asset_metadata.task_image_id = task_images.id
    LEFT JOIN ai_handoff_logs ON ai_handoff_logs.task_id = generation_tasks.id AND ai_handoff_logs.hidden = 0
    ${latestLogJoin()}
    WHERE ${where.join(' AND ')}
  `;
  const rows = all(
    `SELECT task_images.*, generation_tasks.user_id, generation_tasks.product_name, generation_tasks.main_title,
            generation_tasks.status AS task_status, generation_tasks.created_at AS task_created_at,
            platform_formats.platform_key, platform_formats.format_name,
            asset_metadata.favorite, asset_metadata.archived, asset_metadata.tags, asset_metadata.notes,
            latest_log.provider, latest_log.model, latest_log.image_count, latest_log.cost_usd, latest_log.raw_response_json
     ${from}
     GROUP BY task_images.id
     ORDER BY task_images.id DESC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  ).map(serializeAsset);
  const total = Number(get(`SELECT COUNT(*) AS count FROM (SELECT task_images.id ${from} GROUP BY task_images.id)`, params)?.count || 0);
  return { assets: rows, total, limit, offset };
}

export function updateAssetMetadata({ user, assetId, body = {}, admin = false, req = null }) {
  const asset = get(
    `SELECT task_images.id, generation_tasks.user_id
     FROM task_images
     INNER JOIN generation_tasks ON generation_tasks.id = task_images.task_id
     WHERE task_images.id = ? AND task_images.deleted_at IS NULL`,
    [Number(assetId)],
  );
  if (!asset) throw httpError('Asset not found.', 404);
  if (!admin && asset.user_id !== user.id) throw httpError('Forbidden.', 403);

  const existing = get('SELECT id FROM asset_metadata WHERE task_image_id = ?', [asset.id]);
  const values = {
    favorite: body.favorite === undefined ? null : Number(Boolean(body.favorite)),
    archived: body.archived === undefined ? null : Number(Boolean(body.archived)),
    tags: body.tags === undefined ? null : normalizeTags(body.tags),
    notes: body.notes === undefined ? null : String(body.notes || '').slice(0, 1000),
  };
  if (existing) {
    const sets = [];
    const params = [];
    Object.entries(values).forEach(([key, value]) => {
      if (value !== null) {
        sets.push(`${key} = ?`);
        params.push(value);
      }
    });
    sets.push('updated_at = ?');
    params.push(now(), existing.id);
    run(`UPDATE asset_metadata SET ${sets.join(', ')} WHERE id = ?`, params);
  } else {
    run(
      `INSERT INTO asset_metadata (task_image_id, user_id, favorite, archived, tags, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        asset.id,
        asset.user_id,
        values.favorite ?? 0,
        values.archived ?? 0,
        values.tags,
        values.notes,
        now(),
        now(),
      ],
    );
  }
  recordAuditLog({
    actorType: user.role === 'admin' ? 'admin' : 'user',
    actorId: user.id,
    action: 'asset_metadata_update',
    targetType: 'task_image',
    targetId: asset.id,
    metadata: values,
    ip: req?.ip,
    userAgent: req?.get?.('user-agent'),
  });
  return get('SELECT * FROM asset_metadata WHERE task_image_id = ?', [asset.id]);
}

export function exportAssetManifest({ user, ids = [], admin = false } = {}) {
  const cleanIds = String(ids || '')
    .split(',')
    .map((id) => Number(id.trim()))
    .filter(Boolean);
  if (!cleanIds.length) return { ok: true, items: [] };
  const placeholders = cleanIds.map(() => '?').join(',');
  const params = [...cleanIds];
  let ownerSql = '';
  if (!admin) {
    ownerSql = 'AND generation_tasks.user_id = ?';
    params.push(Number(user.id));
  }
  const rows = all(
    `SELECT task_images.*, generation_tasks.product_name, platform_formats.format_name
     FROM task_images
     INNER JOIN generation_tasks ON generation_tasks.id = task_images.task_id
     LEFT JOIN task_formats ON task_formats.task_id = generation_tasks.id
     LEFT JOIN platform_formats ON platform_formats.id = task_formats.platform_format_id
     WHERE task_images.id IN (${placeholders}) ${ownerSql}
     GROUP BY task_images.id
     ORDER BY task_images.id DESC`,
    params,
  );
  return {
    ok: true,
    items: rows.map((row) => ({
      url: storageUrl(row.storage_path),
      filename: row.storage_path.split('/').pop(),
      task_id: row.task_id,
      format: row.format_name || '',
    })),
  };
}

function serializeAsset(row) {
  const meta = parseCostLogMeta(row);
  return {
    ...row,
    url: storageUrl(row.storage_path),
    provider: meta.provider,
    model: meta.model,
    image_mode: meta.image_mode,
    storage_disk: meta.storage_disk || config.filesystemDisk,
    cost: meta.cost,
    format: row.format_name || row.platform_key || '',
    favorite: Boolean(row.favorite),
    archived: Boolean(row.archived),
    tags: safeTags(row.tags),
    notes: row.notes || '',
  };
}

function normalizeTags(tags) {
  if (Array.isArray(tags)) return JSON.stringify(tags.map((tag) => String(tag).trim()).filter(Boolean).slice(0, 20));
  return JSON.stringify(String(tags || '').split(',').map((tag) => tag.trim()).filter(Boolean).slice(0, 20));
}

function safeTags(tags) {
  try {
    return JSON.parse(tags || '[]');
  } catch {
    return [];
  }
}

function httpError(message, status) {
  const error = new Error(message);
  error.status = status;
  return error;
}
