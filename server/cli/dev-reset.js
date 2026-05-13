import { runDevReset } from '../services/DevResetService.js';

try {
  const result = await runDevReset(process.env);
  console.log('Development reset complete.');
  console.log(`Admin ready: ${result.adminEmail}`);
  result.cleaned.forEach((item) => console.log(`Cleaned: ${item}`));
} catch (error) {
  console.error(`[dev:reset] ${error.message}`);
  process.exitCode = 1;
}

