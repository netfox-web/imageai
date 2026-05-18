import { formatReleaseReadiness, runReleaseReadiness } from '../services/ReleaseReadiness.js';

try {
  const result = runReleaseReadiness();
  console.log(formatReleaseReadiness(result));
  if (!result.ok) process.exitCode = 1;
} catch (error) {
  console.error(`[release:check] failed: ${error.message}`);
  process.exitCode = 1;
}

