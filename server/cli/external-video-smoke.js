import { runExternalVideoSmoke, formatExternalVideoSmokeResult } from '../services/ExternalVideoSmoke.js';

const baseUrl = process.env.EXTERNAL_AI_BASE_URL || '';

if (!baseUrl) {
  console.error('[smoke:external-video] EXTERNAL_AI_BASE_URL is not configured.');
  console.error('[smoke:external-video] Try: $env:EXTERNAL_AI_BASE_URL="http://localhost:3099"');
  process.exit(1);
}

const result = await runExternalVideoSmoke({
  baseUrl,
  apiKey: process.env.EXTERNAL_AI_API_KEY || '',
  expectedMode: process.env.EXTERNAL_VIDEO_SMOKE_EXPECT || process.env.MOCK_EXTERNAL_MODE || 'auto',
});

console.log(formatExternalVideoSmokeResult(result));
if (!result.ok) process.exitCode = 1;

