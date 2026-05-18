import { runRcSmokeChecklist, formatRcSmokeChecklist } from '../services/RcSmokeChecklist.js';

try {
  const result = runRcSmokeChecklist();
  console.log(formatRcSmokeChecklist(result));
  if (!result.ok) process.exitCode = 1;
} catch (error) {
  console.error(`[rc:smoke] failed: ${error.message}`);
  process.exitCode = 1;
}

