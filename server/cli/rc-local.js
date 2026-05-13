import { initDatabase } from '../db/database.js';
import { migrate } from '../db/migrations.js';
import { runRcLocalDiagnostics } from '../services/RcLocalDiagnostics.js';

await initDatabase();
await migrate();

try {
  const result = await runRcLocalDiagnostics();
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
} catch (error) {
  console.error(`[rc:local] failed: ${error.message}`);
  process.exitCode = 1;
}
