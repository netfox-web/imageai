import { config, warnForProductionConfig } from './config/index.js';
import { initDatabase } from './db/database.js';
import { migrate } from './db/migrations.js';
import { queueService } from './services/QueueService.js';

await initDatabase();
await migrate();
warnForProductionConfig();

console.log(`Worker started with QUEUE_DRIVER=${config.queueDriver}. Polling every ${config.queuePollIntervalMs}ms.`);

async function tick() {
  try {
    const processed = await queueService.processPendingTasks(10);
    if (processed) {
      console.log(`Worker processed ${processed} pending task(s).`);
    }
  } catch (error) {
    console.error(`Worker error: ${error.message}`);
  }
}

await tick();
setInterval(tick, config.queuePollIntervalMs);
