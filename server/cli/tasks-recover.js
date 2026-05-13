import { initDatabase } from '../db/database.js';
import { migrate } from '../db/migrations.js';
import { formatRecoveryResult, recoverStuckTasks } from '../services/TaskRecoveryService.js';

await initDatabase();
await migrate();

try {
  const result = recoverStuckTasks();
  console.log(formatRecoveryResult(result));
} catch (error) {
  console.error(`[tasks:recover] failed: ${error.message}`);
  process.exitCode = 1;
}
