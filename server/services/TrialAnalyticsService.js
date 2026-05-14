import { all, get } from '../db/database.js';
import { listFeedbackReports } from './FeedbackService.js';

export function trialAnalyticsSummary() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayIso = today.toISOString();
  const count = (sql, params = []) => Number(get(sql, params)?.count || 0);
  const tasksToday = count('SELECT COUNT(*) AS count FROM generation_tasks WHERE created_at >= ? AND deleted_at IS NULL', [todayIso]);
  const successToday = count("SELECT COUNT(*) AS count FROM generation_tasks WHERE created_at >= ? AND status = 'success' AND deleted_at IS NULL", [todayIso]);
  const failedToday = count("SELECT COUNT(*) AS count FROM generation_tasks WHERE created_at >= ? AND status = 'failed' AND deleted_at IS NULL", [todayIso]);
  const outputImagesToday = count(
    `SELECT COUNT(*) AS count
     FROM task_images
     INNER JOIN generation_tasks ON generation_tasks.id = task_images.task_id
     WHERE task_images.created_at >= ? AND task_images.type = 'output' AND task_images.deleted_at IS NULL`,
    [todayIso],
  );
  const latencyLogs = all('SELECT raw_response_json FROM ai_cost_logs WHERE created_at >= ? LIMIT 500', [todayIso]);
  let latencyTotal = 0;
  let latencyCount = 0;
  latencyLogs.forEach((log) => {
    try {
      const parsed = JSON.parse(log.raw_response_json || '{}');
      const latency = Number(parsed.latency_ms);
      if (Number.isFinite(latency)) {
        latencyTotal += latency;
        latencyCount += 1;
      }
    } catch {}
  });

  return {
    today_login_count: count('SELECT COUNT(*) AS count FROM users WHERE last_login_at >= ?', [todayIso]),
    today_new_users: count('SELECT COUNT(*) AS count FROM users WHERE created_at >= ?', [todayIso]),
    today_tasks: tasksToday,
    today_success_tasks: successToday,
    today_failed_tasks: failedToday,
    today_generated_images: outputImagesToday,
    feedback_open_count: count("SELECT COUNT(*) AS count FROM feedback_reports WHERE status = 'open'"),
    most_used_formats: all(
      `SELECT COALESCE(platform_formats.format_name, task_formats.custom_width || 'x' || task_formats.custom_height, 'unknown') AS format,
              COUNT(*) AS count
       FROM task_formats
       LEFT JOIN platform_formats ON platform_formats.id = task_formats.platform_format_id
       GROUP BY format
       ORDER BY count DESC
       LIMIT 10`,
    ),
    provider_split: all(
      `SELECT COALESCE(ai_cost_logs.provider, generation_tasks.resolved_provider, generation_tasks.requested_provider, 'unknown') AS provider,
              COUNT(*) AS count
       FROM generation_tasks
       LEFT JOIN ai_cost_logs ON ai_cost_logs.id = (
         SELECT id FROM ai_cost_logs WHERE ai_cost_logs.task_id = generation_tasks.id ORDER BY id DESC LIMIT 1
       )
       WHERE generation_tasks.deleted_at IS NULL
       GROUP BY provider
       ORDER BY count DESC
       LIMIT 10`,
    ),
    average_task_latency_ms: latencyCount ? Math.round(latencyTotal / latencyCount) : 0,
    failed_reason_top_list: all(
      `SELECT COALESCE(last_error_code, error_message, 'unknown') AS reason, COUNT(*) AS count
       FROM generation_tasks
       WHERE status = 'failed' AND deleted_at IS NULL
       GROUP BY reason
       ORDER BY count DESC
       LIMIT 10`,
    ),
    recent_feedback: listFeedbackReports({ query: { limit: 10 }, admin: true }).reports,
    recent_failed_tasks: all(
      `SELECT id, user_id, product_name, status, error_message, last_error_code, created_at, updated_at
       FROM generation_tasks
       WHERE status = 'failed' AND deleted_at IS NULL
       ORDER BY id DESC
       LIMIT 10`,
    ),
    recent_assets: all(
      `SELECT task_images.id, task_images.task_id, task_images.type, task_images.storage_path,
              generation_tasks.product_name, task_images.created_at
       FROM task_images
       INNER JOIN generation_tasks ON generation_tasks.id = task_images.task_id
       WHERE task_images.type = 'output' AND task_images.deleted_at IS NULL
       ORDER BY task_images.id DESC
       LIMIT 10`,
    ).map((asset) => ({ ...asset, storage_path: asset.storage_path ? '[redacted_storage_path]' : null })),
    secrets_redacted: true,
  };
}
