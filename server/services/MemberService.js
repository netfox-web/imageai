import { all, get } from '../db/database.js';
import { config } from '../config/index.js';
import { GenerationTask } from '../models/index.js';
import { storageUrl } from './StorageService.js';
import { parseCostLogMeta } from './AdminService.js';

function limitOffset(query = {}, fallbackLimit = 20) {
  const limit = Math.min(Math.max(Number(query.limit || fallbackLimit), 1), 100);
  const offset = Math.max(Number(query.offset || 0), 0);
  return { limit, offset };
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

export function serializeMemberTask(row) {
  const meta = parseCostLogMeta({
    provider: row.provider,
    model: row.model,
    image_count: row.image_count,
    cost_usd: row.cost_usd,
    raw_response_json: row.raw_response_json,
  });
  return {
    ...row,
    provider: meta.provider,
    model: meta.model,
    image_mode: meta.image_mode,
    used_reference_image: meta.used_reference_image,
    storage_disk: meta.storage_disk || config.filesystemDisk,
    latency_ms: meta.latency_ms,
    cost: meta.cost,
    fallback_used: meta.fallback_used,
    fallback_reason: meta.fallback_reason,
    failed_reason: meta.error_message || row.last_error_message || row.error_message || '',
    output_count: Number(row.output_count || meta.image_count || 0),
    metadata: meta,
  };
}

export function listMemberTasks(userId, query = {}) {
  const { limit, offset } = limitOffset(query);
  const where = ['generation_tasks.user_id = ?', 'generation_tasks.deleted_at IS NULL'];
  const params = [Number(userId)];
  if (query.status && query.status !== 'all') {
    where.push('generation_tasks.status = ?');
    params.push(query.status);
  }
  if (query.tool_type) {
    where.push('generation_tasks.tool_type = ?');
    params.push(query.tool_type);
  }
  if (query.q) {
    where.push('(CAST(generation_tasks.id AS TEXT) = ? OR generation_tasks.product_name LIKE ? OR generation_tasks.main_title LIKE ? OR generation_tasks.custom_prompt LIKE ?)');
    params.push(String(query.q), `%${query.q}%`, `%${query.q}%`, `%${query.q}%`);
  }
  const from = `
    FROM generation_tasks
    ${latestLogJoin()}
    WHERE ${where.join(' AND ')}
  `;
  const rows = all(
    `SELECT generation_tasks.*, latest_log.provider, latest_log.model, latest_log.image_count,
            latest_log.cost_usd, latest_log.raw_response_json,
            (SELECT COUNT(*) FROM task_images WHERE task_images.task_id = generation_tasks.id AND type = 'output' AND deleted_at IS NULL) AS output_count
     ${from}
     ORDER BY generation_tasks.created_at DESC, generation_tasks.id DESC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  ).map(serializeMemberTask);
  const total = Number(get(`SELECT COUNT(*) AS count ${from}`, params)?.count || 0);
  return { tasks: rows, total, limit, offset };
}

export function listMemberAssets(userId, query = {}) {
  const { limit, offset } = limitOffset(query, 80);
  const where = ['generation_tasks.user_id = ?', 'task_images.deleted_at IS NULL'];
  const params = [Number(userId)];
  const type = query.type || 'all';
  if (type && type !== 'all') {
    where.push('task_images.type = ?');
    params.push(type);
  }
  if (query.q) {
    where.push('(CAST(generation_tasks.id AS TEXT) = ? OR generation_tasks.product_name LIKE ? OR generation_tasks.main_title LIKE ?)');
    params.push(String(query.q), `%${query.q}%`, `%${query.q}%`);
  }
  if (query.format && query.format !== 'all') {
    where.push('(platform_formats.platform_key = ? OR platform_formats.format_name LIKE ?)');
    params.push(query.format, `%${query.format}%`);
  }
  const from = `
    FROM task_images
    INNER JOIN generation_tasks ON generation_tasks.id = task_images.task_id
    LEFT JOIN task_formats ON task_formats.task_id = generation_tasks.id
    LEFT JOIN platform_formats ON platform_formats.id = task_formats.platform_format_id
    ${latestLogJoin()}
    WHERE ${where.join(' AND ')}
  `;
  const rows = all(
    `SELECT task_images.*, generation_tasks.product_name, generation_tasks.main_title,
            generation_tasks.status AS task_status, generation_tasks.created_at AS task_created_at,
            platform_formats.platform_key, platform_formats.format_name,
            latest_log.provider, latest_log.model, latest_log.image_count, latest_log.cost_usd, latest_log.raw_response_json
     ${from}
     GROUP BY task_images.id
     ORDER BY task_images.id DESC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  ).map((row) => {
    const meta = parseCostLogMeta(row);
    return {
      ...row,
      url: storageUrl(row.storage_path),
      provider: meta.provider,
      image_mode: meta.image_mode,
      storage_disk: meta.storage_disk || config.filesystemDisk,
      format: row.format_name || row.platform_key || '',
    };
  });
  const total = Number(get(`SELECT COUNT(*) AS count FROM (${`SELECT task_images.id ${from} GROUP BY task_images.id`})`, params)?.count || 0);
  return { assets: rows, total, limit, offset };
}

export function dashboardSummary(user) {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const today = todayStart.toISOString();
  const taskCounts = {
    todayTasks: Number(get('SELECT COUNT(*) AS count FROM generation_tasks WHERE user_id = ? AND created_at >= ?', [user.id, today])?.count || 0),
    completedTasks: Number(get("SELECT COUNT(*) AS count FROM generation_tasks WHERE user_id = ? AND status = 'success'", [user.id])?.count || 0),
    failedTasks: Number(get("SELECT COUNT(*) AS count FROM generation_tasks WHERE user_id = ? AND status = 'failed'", [user.id])?.count || 0),
  };
  return {
    user: { id: user.id, email: user.email, role: user.role },
    stats: {
      creditsBalance: user.credits_balance,
      ...taskCounts,
    },
    mode: {
      provider: config.aiProvider,
      fakeMode: config.aiProvider === 'fake',
      storageDisk: config.filesystemDisk,
      queueDriver: config.queueDriver,
    },
    recentTasks: listMemberTasks(user.id, { limit: 5 }).tasks,
    recentAssets: listMemberAssets(user.id, { type: 'output', limit: 5 }).assets,
  };
}

export function creditsSummary(userId, query = {}) {
  const { limit, offset } = limitOffset(query, 50);
  const transactions = all(
    'SELECT * FROM credit_transactions WHERE user_id = ? ORDER BY id DESC LIMIT ? OFFSET ?',
    [Number(userId), limit, offset],
  );
  const balance = Number(get('SELECT credits_balance FROM users WHERE id = ?', [Number(userId)])?.credits_balance || 0);
  const totalSpent = Math.abs(Number(get("SELECT COALESCE(SUM(amount), 0) AS total FROM credit_transactions WHERE user_id = ? AND type = 'consume'", [Number(userId)])?.total || 0));
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todaySpent = Math.abs(Number(get("SELECT COALESCE(SUM(amount), 0) AS total FROM credit_transactions WHERE user_id = ? AND type = 'consume' AND created_at >= ?", [Number(userId), today.toISOString()])?.total || 0));
  const taskCosts = all(
    `SELECT generation_tasks.id AS task_id, generation_tasks.credits_cost, generation_tasks.status,
            generation_tasks.product_name, generation_tasks.created_at,
            latest_log.provider, latest_log.model, latest_log.cost_usd, latest_log.raw_response_json
     FROM generation_tasks
     ${latestLogJoin()}
     WHERE generation_tasks.user_id = ? AND generation_tasks.deleted_at IS NULL
     ORDER BY generation_tasks.id DESC
     LIMIT 20`,
    [Number(userId)],
  ).map((row) => ({ ...row, metadata: parseCostLogMeta(row) }));
  return {
    balance,
    transactions,
    totalSpent,
    todaySpent,
    taskCosts,
    demoCredits: true,
    fakeProviderCost: config.fakeTaskCost,
    openaiEstimatedCostCredits: config.openaiTaskEstimatedCostCredits,
    geminiEstimatedCostCredits: config.geminiTaskEstimatedCostCredits,
    claudeEstimatedCostCredits: config.claudeTaskEstimatedCostCredits,
  };
}
