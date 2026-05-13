import { runAiPing } from '../services/AiPingDiagnostics.js';

try {
  const result = await runAiPing();
  console.log(`[ai:ping] provider=${result.provider} model=${result.model || '-'} ok=${result.ok}`);
  console.log(`[ai:ping] diagnosis=${result.diagnosis?.code}: ${result.diagnosis?.message}`);
  console.log(`[ai:ping] latency_ms=${result.latency_ms} retryable=${result.retryable}`);
  if (result.output) console.log(`[ai:ping] output=${String(result.output).slice(0, 500)}`);
  if (result.usage) console.log(`[ai:ping] usage=${JSON.stringify(result.usage)}`);
  console.log(`[ai:ping] report=${process.env.AI_PING_REPORT_PATH || './tmp/ai-ping-last.json'}`);
  if (!result.ok) process.exitCode = 1;
} catch (error) {
  console.error(`[ai:ping] failed: ${error.message}`);
  process.exitCode = 1;
}
