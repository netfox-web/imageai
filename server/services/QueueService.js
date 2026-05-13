import { config } from '../config/index.js';
import { GenerationTask } from '../models/index.js';
import { all } from '../db/database.js';
import { GenerateTaskJob } from '../jobs/GenerateTaskJob.js';

export class QueueService {
  dispatchGenerateTask(taskId) {
    const driver = String(config.queueDriver || 'local').toLowerCase();
    if (driver === 'worker') {
      return { queued: true, driver };
    }
    if (driver === 'sync') {
      setTimeout(() => GenerateTaskJob.handle(taskId), 0);
      return { queued: true, driver };
    }
    GenerateTaskJob.dispatch(taskId);
    return { queued: true, driver: 'local' };
  }

  async processPendingTasks(limit = 5) {
    const tasks = all(
      "SELECT id FROM generation_tasks WHERE status = 'pending' AND deleted_at IS NULL ORDER BY id ASC LIMIT ?",
      [Number(limit)],
    );

    for (const task of tasks) {
      await GenerateTaskJob.handle(task.id);
    }

    return tasks.length;
  }

  pendingCount() {
    return Number(
      all("SELECT COUNT(*) AS count FROM generation_tasks WHERE status = 'pending' AND deleted_at IS NULL")[0]?.count || 0,
    );
  }
}

export const queueService = new QueueService();
