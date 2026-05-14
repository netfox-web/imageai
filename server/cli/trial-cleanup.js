#!/usr/bin/env node
import { config } from '../config/index.js';
import { initDatabase } from '../db/database.js';
import { migrate } from '../db/migrations.js';
import { formatTrialCleanup, runTrialCleanup } from '../services/TrialCleanupService.js';

try {
  await initDatabase({ dbPath: config.databasePath });
  await migrate();
  const report = runTrialCleanup();
  console.log(formatTrialCleanup(report));
  process.exit(report.ok ? 0 : 1);
} catch (error) {
  console.error(`trial:cleanup failed: ${error.message}`);
  process.exit(1);
}
