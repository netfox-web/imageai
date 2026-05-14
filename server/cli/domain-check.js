import { formatDomainCheck, runDomainCheck } from '../services/DomainDiagnostics.js';

try {
  const result = await runDomainCheck(process.env);
  console.log(formatDomainCheck(result));
  process.exit(result.ok ? 0 : 1);
} catch (error) {
  console.error(`[domain] failed: ${error.message}`);
  process.exit(1);
}
