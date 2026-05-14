import fs from 'node:fs';
import path from 'node:path';
import { all, now, run } from '../db/database.js';
import { config } from '../config/index.js';

const secretKey = /(api[_-]?key|secret|token|password|authorization|hash|credential)/i;

export function runTrialCleanup(options = {}) {
  const dryRun = options.dryRun ?? config.trialCleanupDryRun;
  const olderThanDays = Number(options.olderThanDays ?? config.trialCleanupOlderThanDays);
  const includeOutputs = Boolean(options.includeOutputs ?? config.trialCleanupIncludeOutputs);
  const allowWrite = Boolean(options.allowWrite ?? config.allowTrialCleanupWrite);
  if (!dryRun && isProductionRuntime() && !allowWrite) {
    throw new Error('Non-dry-run trial cleanup is blocked in production unless ALLOW_TRIAL_CLEANUP_WRITE=true.');
  }
  const cutoff = new Date(Date.now() - Math.max(1, olderThanDays) * 24 * 60 * 60 * 1000).toISOString();
  const oldFailedTasks = all(
    `SELECT id, status, created_at FROM generation_tasks
     WHERE status = 'failed' AND deleted_at IS NULL AND created_at < ?
     ORDER BY id ASC`,
    [cutoff],
  );
  const archivedAssets = all(
    `SELECT task_images.id, task_images.storage_path, task_images.created_at
     FROM task_images
     INNER JOIN asset_metadata ON asset_metadata.task_image_id = task_images.id
     WHERE task_images.deleted_at IS NULL AND COALESCE(asset_metadata.archived, 0) = 1 AND task_images.created_at < ?
     ORDER BY task_images.id ASC`,
    [cutoff],
  );
  const testHandoffs = all(
    `SELECT id, created_at FROM ai_handoff_logs
     WHERE hidden = 1 AND deleted_at IS NULL AND created_at < ?
     ORDER BY id ASC`,
    [cutoff],
  );
  const tmpReports = listTmpReports();
  const outputFiles = includeOutputs
    ? archivedAssets.map((asset) => resolveOutputPath(asset.storage_path)).filter(Boolean)
    : [];

  if (!dryRun) {
    const timestamp = now();
    oldFailedTasks.forEach((task) => run('UPDATE generation_tasks SET deleted_at = ?, updated_at = ? WHERE id = ?', [timestamp, timestamp, task.id]));
    archivedAssets.forEach((asset) => run('UPDATE task_images SET deleted_at = ?, updated_at = ? WHERE id = ?', [timestamp, timestamp, asset.id]));
    testHandoffs.forEach((handoff) => run('UPDATE ai_handoff_logs SET deleted_at = ?, updated_at = ? WHERE id = ?', [timestamp, timestamp, handoff.id]));
    [...tmpReports, ...outputFiles].forEach((filePath) => {
      assertSafeTrialPath(filePath);
      if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) fs.unlinkSync(filePath);
    });
  }

  const report = redact({
    ok: true,
    dry_run: dryRun,
    cutoff,
    older_than_days: olderThanDays,
    include_outputs: includeOutputs,
    selected: {
      old_failed_tasks: oldFailedTasks.map((task) => ({ id: task.id, status: task.status, created_at: task.created_at })),
      archived_assets: archivedAssets.map((asset) => ({ id: asset.id, created_at: asset.created_at })),
      test_handoffs: testHandoffs.map((handoff) => ({ id: handoff.id, created_at: handoff.created_at })),
      tmp_reports: tmpReports.map((filePath) => path.relative(config.rootDir, filePath).replaceAll('\\', '/')),
      output_files: outputFiles.map((filePath) => path.relative(config.rootDir, filePath).replaceAll('\\', '/')),
    },
    deleted_counts: dryRun
      ? { old_failed_tasks: 0, archived_assets: 0, test_handoffs: 0, tmp_reports: 0, output_files: 0 }
      : {
          old_failed_tasks: oldFailedTasks.length,
          archived_assets: archivedAssets.length,
          test_handoffs: testHandoffs.length,
          tmp_reports: tmpReports.length,
          output_files: outputFiles.length,
        },
    safety: {
      production_write_allowed: allowWrite,
      safe_paths_only: true,
      source_files_ignored: true,
    },
    generated_at: now(),
  });
  writeTrialCleanupReport(report, options.reportPath || config.trialCleanupReportPath);
  return { ...report, report_path: options.reportPath || config.trialCleanupReportPath };
}

export function readTrialCleanupReport(reportPath = config.trialCleanupReportPath) {
  const absolute = path.resolve(config.rootDir, reportPath);
  if (!fs.existsSync(absolute)) return null;
  try {
    return JSON.parse(fs.readFileSync(absolute, 'utf8'));
  } catch {
    return null;
  }
}

export function writeTrialCleanupReport(report, reportPath = config.trialCleanupReportPath) {
  const absolute = path.resolve(config.rootDir, reportPath);
  assertSafeTrialPath(absolute);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, `${JSON.stringify(redact(report), null, 2)}\n`);
}

export function formatTrialCleanup(report) {
  return [
    `trial:cleanup ${report.ok ? 'PASS' : 'FAIL'}`,
    `dry_run=${report.dry_run}`,
    `old_failed_tasks=${report.selected?.old_failed_tasks?.length || 0}`,
    `archived_assets=${report.selected?.archived_assets?.length || 0}`,
    `test_handoffs=${report.selected?.test_handoffs?.length || 0}`,
    `tmp_reports=${report.selected?.tmp_reports?.length || 0}`,
    `report=${report.report_path || config.trialCleanupReportPath}`,
  ].join('\n');
}

export function assertSafeTrialPath(filePath) {
  const resolved = path.resolve(filePath);
  const safeRoots = [
    path.resolve(config.rootDir, 'tmp'),
    path.resolve(config.rootDir, 'server/storage/outputs'),
    path.resolve(config.rootDir, 'server/storage/uploads'),
  ];
  const safe = safeRoots.some((root) => resolved === root || resolved.startsWith(`${root}${path.sep}`));
  if (!safe) throw new Error(`Refusing unsafe trial cleanup path: ${resolved}`);
  const basename = path.basename(resolved).toLowerCase();
  if (['.env', 'package.json', 'readme.md', 'release_checklist.md'].includes(basename)) {
    throw new Error(`Refusing protected trial cleanup file: ${resolved}`);
  }
  return resolved;
}

function listTmpReports() {
  const tmpDir = path.resolve(config.rootDir, 'tmp');
  if (!fs.existsSync(tmpDir)) return [];
  return fs.readdirSync(tmpDir)
    .filter((name) => /^(trial|domain|ai-ping|rc-local|storage-check).*\.json$/i.test(name))
    .map((name) => path.join(tmpDir, name))
    .filter((filePath) => {
      assertSafeTrialPath(filePath);
      return fs.statSync(filePath).isFile();
    });
}

function resolveOutputPath(storagePath) {
  if (!storagePath) return null;
  const normalized = String(storagePath).replaceAll('\\', '/').replace(/^\/+/, '');
  const absolute = path.resolve(config.rootDir, 'server/storage', normalized);
  assertSafeTrialPath(absolute);
  return absolute;
}

function isProductionRuntime() {
  return config.nodeEnv === 'production' || config.appEnv === 'production';
}

function redact(value) {
  if (typeof value === 'string') {
    return value
      .replace(/sk-[A-Za-z0-9_-]{8,}/g, '[redacted_api_key]')
      .replace(/AIza[0-9A-Za-z_-]{20,}/g, '[redacted_api_key]')
      .replace(/[A-Za-z0-9+/=]{240,}/g, '[redacted_base64]');
  }
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, secretKey.test(key) ? '[redacted]' : redact(item)]),
    );
  }
  return value;
}
