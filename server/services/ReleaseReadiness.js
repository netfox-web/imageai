import fs from 'node:fs';
import path from 'node:path';
import { config as appConfig } from '../config/index.js';
import { runEnvDiagnostics } from './EnvDiagnostics.js';
import { buildProviderCapabilityMatrix } from './ProviderCapabilityMatrix.js';
import { runRcSmokeChecklist } from './RcSmokeChecklist.js';

export const requiredReleaseDocs = [
  'AGENTS.md',
  'docs/RC_SMOKE_CHECKLIST.md',
  'docs/PROVIDER_TASK_GUARDRAILS.md',
  'docs/RC9_RELEASE_NOTES.md',
  'docs/DEPLOYMENT_PRECHECK.md',
  'docs/ROLLBACK.md',
];

export const requiredReleaseScripts = [
  'test',
  'build',
  'env:check',
  'rc:smoke',
  'mock:external',
  'smoke:external-video',
  'release:check',
];

function pass(key, message, details = {}) {
  return { key, ok: true, message, details };
}

function fail(key, message, details = {}) {
  return { key, ok: false, message, details };
}

export function runReleaseReadiness({
  rootDir = appConfig.rootDir,
  env = process.env,
  config = appConfig,
  packageJsonPath = path.resolve(rootDir, 'package.json'),
} = {}) {
  const checks = [];
  const docs = requiredReleaseDocs.map((relativePath) => {
    const absolutePath = path.resolve(rootDir, relativePath);
    const exists = fs.existsSync(absolutePath);
    checks.push(
      exists
        ? pass(`doc.${relativePath}`, `${relativePath} exists.`)
        : fail(`doc.${relativePath}`, `${relativePath} is missing.`),
    );
    return { path: relativePath, exists };
  });

  let packageJson = {};
  try {
    packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    checks.push(pass('package.json', 'package.json can be parsed.'));
  } catch (error) {
    checks.push(fail('package.json', `package.json could not be parsed: ${error.message}`));
  }

  const scripts = packageJson.scripts || {};
  requiredReleaseScripts.forEach((script) => {
    checks.push(
      scripts[script]
        ? pass(`script.${script}`, `npm script ${script} exists.`)
        : fail(`script.${script}`, `npm script ${script} is missing.`),
    );
  });

  const envResult = runEnvDiagnostics(env, config);
  checks.push(
    envResult.ok
      ? pass('env', 'Environment diagnostics passed.', envResult.env)
      : fail('env', 'Environment diagnostics reported failures.', envResult.env),
  );

  const matrix = buildProviderCapabilityMatrix(config);
  checks.push(
    matrix.tools?.length
      ? pass('provider_matrix', 'Provider capability matrix can be generated.', { tool_count: matrix.tools.length })
      : fail('provider_matrix', 'Provider capability matrix is empty or unavailable.'),
  );

  const rcSmoke = runRcSmokeChecklist({ env, config });
  checks.push(
    rcSmoke.ok
      ? pass('rc_smoke_service', 'RC smoke checklist service returned ok.', rcSmoke.summary)
      : fail('rc_smoke_service', 'RC smoke checklist service reported failures.', rcSmoke.summary),
  );

  return {
    ok: checks.every((check) => check.ok),
    docs,
    scripts: requiredReleaseScripts.map((script) => ({ name: script, exists: Boolean(scripts[script]) })),
    env: envResult.env,
    rc_smoke: rcSmoke.summary,
    checks,
    next_steps: [
      'npm run migrate',
      'npm run seed',
      'npm test',
      'npm run build',
      'npm run env:check',
      'npm run rc:smoke',
      'Optional: npm run mock:external + npm run smoke:external-video',
    ],
  };
}

export function formatReleaseReadiness(result) {
  const lines = [
    '[release:check] RC9 release readiness',
    `[release:check] result=${result.ok ? 'passed' : 'failed'}`,
    `[release:check] docs=${result.docs.filter((doc) => doc.exists).length}/${result.docs.length}`,
    `[release:check] scripts=${result.scripts.filter((script) => script.exists).length}/${result.scripts.length}`,
  ];
  result.checks.forEach((check) => {
    lines.push(`[${check.ok ? 'PASS' : 'FAIL'}] ${check.key}: ${check.message}`);
  });
  lines.push('[release:check] next steps:');
  result.next_steps.forEach((step) => lines.push(`- ${step}`));
  return lines.join('\n');
}
