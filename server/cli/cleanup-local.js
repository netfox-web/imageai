import { runLocalCleanup } from '../services/CleanupService.js';

try {
  const result = await runLocalCleanup(process.env);
  console.log(`Cleanup ${result.dryRun ? 'dry run' : 'complete'}: ${result.files.length} file(s).`);
  result.files.slice(0, 50).forEach((file) => console.log(`${result.dryRun ? 'Would remove' : 'Removed'} [${file.reason}]: ${file.path}`));
  if (result.files.length > 50) console.log(`...and ${result.files.length - 50} more.`);
} catch (error) {
  console.error(`[cleanup:local] ${error.message}`);
  process.exitCode = 1;
}

