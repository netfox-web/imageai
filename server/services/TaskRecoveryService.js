import { all, now, run } from '../db/database.js';

export function findStuckTasks({ afterMinutes = 15 } = {}) {
  const cutoff = new Date(Date.now() - Number(afterMinutes) * 60_000).toISOString();
  return all(
    `SELECT * FROM generation_tasks
     WHERE status = 'processing'
       AND deleted_at IS NULL
       AND COALESCE(processing_started_at, started_at, created_at) < ?
     ORDER BY id ASC`,
    [cutoff],
  );
}

export function recoverStuckTasks({
  afterMinutes = Number(process.env.TASK_RECOVER_AFTER_MINUTES || 15),
  dryRun = String(process.env.TASK_RECOVER_DRY_RUN || 'true') !== 'false',
  action = process.env.TASK_RECOVER_ACTION || 'requeue',
} = {}) {
  const tasks = findStuckTasks({ afterMinutes });
  if (dryRun) {
    return { dryRun: true, action, matched: tasks.length, tasks };
  }

  if (!['requeue', 'fail'].includes(action)) {
    throw new Error('TASK_RECOVER_ACTION must be requeue or fail.');
  }

  for (const task of tasks) {
    if (action === 'requeue') {
      run(
        `UPDATE generation_tasks
         SET status = 'pending', error_message = ?, last_error_code = ?, last_error_message = ?, updated_at = ?
         WHERE id = ?`,
        ['Recovered stuck processing task.', 'stuck_task_requeued', 'Recovered stuck processing task.', now(), task.id],
      );
    } else {
      run(
        `UPDATE generation_tasks
         SET status = 'failed', error_message = ?, last_error_code = ?, last_error_message = ?, failed_at = ?, finished_at = ?, updated_at = ?
         WHERE id = ?`,
        [
          'Marked failed by stuck task recovery.',
          'stuck_task_failed',
          'Marked failed by stuck task recovery.',
          now(),
          now(),
          now(),
          task.id,
        ],
      );
    }
  }

  return { dryRun: false, action, matched: tasks.length, tasks };
}

export function formatRecoveryResult(result) {
  const lines = [
    `[tasks:recover] dry_run=${result.dryRun}`,
    `[tasks:recover] action=${result.action}`,
    `[tasks:recover] matched=${result.matched}`,
  ];
  result.tasks.forEach((task) => lines.push(`- task #${task.id} user=${task.user_id} status=${task.status}`));
  return lines.join('\n');
}
