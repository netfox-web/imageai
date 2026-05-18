import { config as appConfig } from '../config/index.js';
import { runEnvDiagnostics } from './EnvDiagnostics.js';
import { listProviders } from './AIProviderRegistry.js';
import { buildProviderCapabilityMatrix } from './ProviderCapabilityMatrix.js';

export const rcSmokeChecklistPath = 'docs/RC_SMOKE_CHECKLIST.md';
export const providerTaskGuardrailsPath = 'docs/PROVIDER_TASK_GUARDRAILS.md';

const sensitiveTools = ['voice_clone', 'lip_sync', 'face_swap', 'avatar_video'];

function pass(key, message, details = {}) {
  return { key, ok: true, message, details };
}

function fail(key, message, details = {}) {
  return { key, ok: false, message, details };
}

function toolByType(matrix, toolType) {
  return (matrix.tools || []).find((tool) => tool.tool_type === toolType);
}

function providerByName(tool, providerName) {
  return (tool?.providers || []).find((provider) => provider.name === providerName);
}

export function runRcSmokeChecklist({ env = process.env, config = appConfig } = {}) {
  const envResult = runEnvDiagnostics(env, config);
  const providers = listProviders(config);
  const matrix = buildProviderCapabilityMatrix(config);
  const checks = [];

  checks.push(envResult.ok ? pass('env', 'Environment diagnostics passed.', envResult.env) : fail('env', 'Environment diagnostics reported failures.', envResult.env));

  const fakeProvider = providers.find((provider) => provider.name === 'fake');
  checks.push(fakeProvider ? pass('provider.fake', 'Fake provider exists for dev/test smoke runs.') : fail('provider.fake', 'Fake provider is missing from registry.'));

  checks.push(
    providers.length && matrix.tools?.length
      ? pass('matrix.generated', 'Provider capability matrix generated.', { provider_count: providers.length, tool_count: matrix.tools.length })
      : fail('matrix.generated', 'Provider capability matrix did not generate providers/tools.', { provider_count: providers.length, tool_count: matrix.tools?.length || 0 }),
  );

  const imageToVideo = toolByType(matrix, 'image_to_video');
  const openaiVideo = providerByName(imageToVideo, 'openai');
  const fakeVideo = providerByName(imageToVideo, 'fake');
  checks.push(
    imageToVideo
      ? pass('matrix.image_to_video.exists', 'image_to_video is present in the matrix.')
      : fail('matrix.image_to_video.exists', 'image_to_video is missing from the matrix.'),
  );
  checks.push(
    openaiVideo && !openaiVideo.supported && !openaiVideo.live
      ? pass('matrix.image_to_video.openai', 'OpenAI is not marked as image_to_video capable.')
      : fail('matrix.image_to_video.openai', 'OpenAI must not be marked as image_to_video capable.', openaiVideo || {}),
  );
  checks.push(
    fakeVideo && fakeVideo.supported && fakeVideo.fake_only && !fakeVideo.live
      ? pass('matrix.image_to_video.fake', 'Fake image_to_video is marked dev/test only.')
      : fail('matrix.image_to_video.fake', 'Fake image_to_video must be supported but fake_only/live=false.', fakeVideo || {}),
  );

  sensitiveTools.forEach((toolType) => {
    const tool = toolByType(matrix, toolType);
    checks.push(
      tool?.consent_required && tool?.private_by_default
        ? pass(`matrix.${toolType}.safety`, `${toolType} is consent gated and private by default.`)
        : fail(`matrix.${toolType}.safety`, `${toolType} must be consent_required/private_by_default.`, tool || {}),
    );
  });

  const ok = checks.every((check) => check.ok);
  return {
    ok,
    checklist_path: rcSmokeChecklistPath,
    guardrails_path: providerTaskGuardrailsPath,
    env: envResult.env,
    checks,
    summary: {
      passed: checks.filter((check) => check.ok).length,
      failed: checks.filter((check) => !check.ok).length,
      provider_count: providers.length,
      matrix_tool_count: matrix.tools?.length || 0,
    },
  };
}

export function formatRcSmokeChecklist(result) {
  const lines = [
    '[rc:smoke] RC smoke checklist',
    `[rc:smoke] provider_count=${result.summary.provider_count} matrix_tool_count=${result.summary.matrix_tool_count}`,
  ];
  result.checks.forEach((check) => {
    lines.push(`[${check.ok ? 'PASS' : 'FAIL'}] ${check.key}: ${check.message}`);
  });
  lines.push(`[rc:smoke] manual checklist: ${result.checklist_path}`);
  lines.push(`[rc:smoke] provider/task guardrails: ${result.guardrails_path || providerTaskGuardrailsPath}`);
  lines.push('[rc:smoke] optional external video smoke: npm run mock:external');
  lines.push('[rc:smoke] optional external video smoke: EXTERNAL_AI_BASE_URL=http://localhost:3099 npm run smoke:external-video');
  lines.push(`[rc:smoke] result=${result.ok ? 'passed' : 'failed'}`);
  return lines.join('\n');
}
