import { randomBytes } from 'node:crypto';
import { all, get, insert, now, run } from '../db/database.js';
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
    where.push('(CAST(generation_tasks.id AS TEXT) = ? OR generation_tasks.product_name LIKE ? OR generation_tasks.main_title LIKE ? OR generation_tasks.custom_prompt LIKE ? OR asset_metadata.tags LIKE ? OR ai_handoff_logs.external_ref LIKE ?)');
    params.push(String(query.q), `%${query.q}%`, `%${query.q}%`, `%${query.q}%`, `%${query.q}%`, `%${query.q}%`);
  }
  if (query.favorite === '1' || query.favorite === 'true') {
    where.push('COALESCE(asset_metadata.favorite, 0) = 1');
  }
  if (query.archived === 'only') {
    where.push('COALESCE(asset_metadata.archived, 0) = 1');
  } else if (query.archived !== '1' && query.archived !== 'true') {
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
    LEFT JOIN asset_share_tokens active_share
      ON active_share.id = (
        SELECT id FROM asset_share_tokens
        WHERE asset_share_tokens.task_image_id = task_images.id
          AND asset_share_tokens.revoked_at IS NULL
        ORDER BY id DESC
        LIMIT 1
      )
    LEFT JOIN ai_handoff_logs ON ai_handoff_logs.task_id = generation_tasks.id AND ai_handoff_logs.hidden = 0
    ${latestLogJoin()}
    WHERE ${where.join(' AND ')}
  `;
  const rows = all(
    `SELECT task_images.*, generation_tasks.user_id, generation_tasks.product_name, generation_tasks.main_title,
            generation_tasks.status AS task_status, generation_tasks.created_at AS task_created_at,
            platform_formats.platform_key, platform_formats.format_name,
            asset_metadata.favorite, asset_metadata.archived, asset_metadata.tags, asset_metadata.notes,
            active_share.token AS share_token,
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

export function batchUpdateAssets({ user, ids = [], body = {}, admin = false, req = null } = {}) {
  const cleanIds = ids.map(Number).filter(Boolean).slice(0, 200);
  const updated = [];
  cleanIds.forEach((id) => {
    const patch = {};
    if (body.action === 'favorite' || body.favorite !== undefined) patch.favorite = body.favorite ?? true;
    if (body.action === 'archive' || body.archived !== undefined) patch.archived = body.archived ?? true;
    if (body.action === 'tag' || body.tags !== undefined) patch.tags = body.tags;
    if (Object.keys(patch).length) {
      updated.push(updateAssetMetadata({ user, assetId: id, body: patch, admin, req }));
    }
  });
  return { ok: true, updated: updated.length, ids: cleanIds };
}

export function exportAssetsCsv({ user, ids = '', admin = false } = {}) {
  const manifest = exportAssetManifest({ user, ids, admin });
  const columns = ['task_id', 'filename', 'format', 'url'];
  return [
    columns.join(','),
    ...(manifest.items || []).map((item) => columns.map((column) => csvCell(item[column])).join(',')),
  ].join('\n');
}

export function createAssetShareToken({ user, assetId, admin = false, req = null } = {}) {
  const asset = getOwnedAsset({ user, assetId, admin });
  const existing = get(
    `SELECT * FROM asset_share_tokens
     WHERE task_image_id = ? AND revoked_at IS NULL
     ORDER BY id DESC LIMIT 1`,
    [asset.id],
  );
  const row = existing || (() => {
    const token = randomBytes(24).toString('base64url');
    const id = insert(
      `INSERT INTO asset_share_tokens (task_image_id, user_id, token, revoked_at, created_at, updated_at)
       VALUES (?, ?, ?, NULL, ?, ?)`,
      [asset.id, asset.user_id, token, now(), now()],
    );
    return get('SELECT * FROM asset_share_tokens WHERE id = ?', [id]);
  })();
  recordAuditLog({
    actorType: user.role === 'admin' ? 'admin' : 'user',
    actorId: user.id,
    action: 'asset_share_create',
    targetType: 'task_image',
    targetId: asset.id,
    metadata: { task_id: asset.task_id },
    ip: req?.ip,
    userAgent: req?.get?.('user-agent'),
  });
  return { token: row.token, share_url: `/share/${row.token}`, revoked_at: row.revoked_at || null };
}

export function revokeAssetShareToken({ user, assetId, token = '', admin = false, req = null } = {}) {
  const asset = getOwnedAsset({ user, assetId, admin });
  const params = [now(), now(), asset.id];
  let tokenSql = '';
  if (token) {
    tokenSql = 'AND token = ?';
    params.push(token);
  }
  run(`UPDATE asset_share_tokens SET revoked_at = ?, updated_at = ? WHERE task_image_id = ? AND revoked_at IS NULL ${tokenSql}`, params);
  recordAuditLog({
    actorType: user.role === 'admin' ? 'admin' : 'user',
    actorId: user.id,
    action: 'asset_share_revoke',
    targetType: 'task_image',
    targetId: asset.id,
    metadata: { task_id: asset.task_id },
    ip: req?.ip,
    userAgent: req?.get?.('user-agent'),
  });
  return { ok: true };
}

export function getSharedAsset(token) {
  if (!token || String(token).length < 16) return null;
  const row = get(
    `SELECT task_images.id, task_images.task_id, task_images.storage_path, task_images.width, task_images.height,
            task_images.file_size, task_images.mime_type, task_images.created_at,
            generation_tasks.product_name, generation_tasks.main_title, generation_tasks.tool_type,
            platform_formats.format_name, asset_metadata.tags, asset_share_tokens.token
     FROM asset_share_tokens
     INNER JOIN task_images ON task_images.id = asset_share_tokens.task_image_id
     INNER JOIN generation_tasks ON generation_tasks.id = task_images.task_id
     LEFT JOIN task_formats ON task_formats.task_id = generation_tasks.id
     LEFT JOIN platform_formats ON platform_formats.id = task_formats.platform_format_id
     LEFT JOIN asset_metadata ON asset_metadata.task_image_id = task_images.id
     WHERE asset_share_tokens.token = ?
       AND asset_share_tokens.revoked_at IS NULL
       AND task_images.deleted_at IS NULL
       AND generation_tasks.deleted_at IS NULL
     GROUP BY task_images.id
     LIMIT 1`,
    [String(token)],
  );
  if (!row) return null;
  return {
    id: row.id,
    task_id: row.task_id,
    storage_path: row.storage_path,
    image_url: `/share/${encodeURIComponent(row.token)}/image`,
    product_name: row.product_name || row.main_title || 'Shared asset',
    tool_type: row.tool_type,
    format: row.format_name || '',
    width: row.width,
    height: row.height,
    file_size: row.file_size,
    mime_type: row.mime_type,
    tags: safeTags(row.tags),
    created_at: row.created_at,
  };
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
    share_url: row.share_token ? `/share/${row.share_token}` : null,
  };
}

function getOwnedAsset({ user, assetId, admin = false }) {
  const asset = get(
    `SELECT task_images.id, task_images.task_id, task_images.storage_path, generation_tasks.user_id
     FROM task_images
     INNER JOIN generation_tasks ON generation_tasks.id = task_images.task_id
     WHERE task_images.id = ? AND task_images.deleted_at IS NULL`,
    [Number(assetId)],
  );
  if (!asset) throw httpError('Asset not found.', 404);
  if (!admin && asset.user_id !== user.id) throw httpError('Forbidden.', 403);
  return asset;
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

function csvCell(value) {
  const text = String(value ?? '').replaceAll('"', '""');
  return `"${text}"`;
}

function httpError(message, status) {
  const error = new Error(message);
  error.status = status;
  return error;
}
