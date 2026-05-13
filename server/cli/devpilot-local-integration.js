import { runDevPilotLocalIntegration } from '../services/DevPilotLocalIntegrationRunner.js';

try {
  const result = await runDevPilotLocalIntegration(process.env);
  console.log('[devpilot] local integration passed');
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(`[devpilot] local integration failed: ${error.message}`);
  if (error.status) console.error(`[devpilot] status=${error.status} code=${error.code || 'unknown'} retryable=${Boolean(error.retryable)}`);
  process.exitCode = 1;
}

