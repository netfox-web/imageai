#!/usr/bin/env node
import { config } from '../config/index.js';
import { initDatabase } from '../db/database.js';
import { migrate } from '../db/migrations.js';
import { formatTrialCheck, runTrialCheck } from '../services/TrialDiagnostics.js';

try {
  await initDatabase({ dbPath: config.databasePath });
  await migrate();
  const report = await runTrialCheck();
  console.log(formatTrialCheck(report));
  process.exit(report.ok ? 0 : 1);
} catch (error) {
  console.error(`trial:check failed: ${error.message}`);
  process.exit(1);
}
