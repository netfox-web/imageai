import fs from 'node:fs/promises';
import path from 'node:path';
import { all, initDatabase } from '../db/database.js';
import { migrate } from '../db/migrations.js';
import { config } from '../config/index.js';
import { redactBase64, safeRawResponse } from './AdminService.js';

function stripUser(row) {
  const { password, google_id, ...safe } = row;
  return safe;
}

function safeCostLog(row) {
  return {
    id: row.id,
    task_id: row.task_id,
    provider: row.provider,
    model: row.model,
    image_count: row.image_count,
    cost_usd: row.cost_usd,
    raw_response_json: redactBase64(safeRawResponse(row.raw_response_json)),
    created_at: row.created_at,
  };
}

export async function exportDemoData(env = process.env) {
  await initDatabase();
  await migrate();
  const outputPath = path.resolve(config.rootDir, env.DEMO_EXPORT_PATH || 'tmp/demo-export.json');
  const data = redactBase64({
    exported_at: new Date().toISOString(),
    users: all('SELECT * FROM users ORDER BY id').map(stripUser),
    tasks: all('SELECT id, user_id, tool_type, status, product_name, main_title, credits_cost, created_at, updated_at FROM generation_tasks ORDER BY id'),
    task_images: all('SELECT id, task_id, type, role, storage_path, width, height, file_size, mime_type, created_at FROM task_images ORDER BY id'),
    credit_transactions: all('SELECT id, user_id, type, amount, balance_after, related_task_id, note, created_at FROM credit_transactions ORDER BY id'),
    ai_cost_logs: all('SELECT * FROM ai_cost_logs ORDER BY id').map(safeCostLog),
    quality_reviews: all('SELECT * FROM quality_reviews ORDER BY id'),
  });
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, JSON.stringify(data, null, 2));
  return { ok: true, outputPath, counts: Object.fromEntries(Object.entries(data).filter(([, value]) => Array.isArray(value)).map(([key, value]) => [key, value.length])) };
}

