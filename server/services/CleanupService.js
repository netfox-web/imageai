import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config/index.js';

function bool(value, fallback = false) {
  if (value === undefined) return fallback;
  return String(value).toLowerCase() === 'true';
}

function isProduction(env = process.env) {
  const nodeEnv = env.NODE_ENV || config.nodeEnv;
  const appEnv = env.APP_ENV || config.appEnv || nodeEnv;
  return nodeEnv === 'production' || appEnv === 'production';
}

function assertSafePath(targetPath) {
  const resolved = path.resolve(targetPath);
  const allowedRoots = [
    path.resolve(config.rootDir, 'tmp'),
    path.resolve(config.rootDir, 'server/storage/uploads'),
    path.resolve(config.rootDir, 'server/storage/outputs'),
  ];
  const safe = allowedRoots.some((root) => {
    const relative = path.relative(root, resolved);
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
  });
  if (!safe) throw new Error(`Refusing unsafe cleanup path: ${resolved}`);
  return resolved;
}

async function collectFiles(targetPath) {
  const root = assertSafePath(targetPath);
  const results = [];
  async function walk(current) {
    let entries = [];
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch (error) {
      if (error.code === 'ENOENT') return;
      throw error;
    }
    await Promise.all(entries.map(async (entry) => {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) return walk(fullPath);
      const stat = await fs.stat(fullPath);
      results.push({ path: fullPath, mtimeMs: stat.mtimeMs, size: stat.size });
    }));
  }
  await walk(root);
  return results;
}

export async function runLocalCleanup(env = process.env) {
  const dryRun = bool(env.CLEANUP_DRY_RUN, true);
  if (isProduction(env) && !dryRun && !bool(env.ALLOW_PRODUCTION_CLEANUP, false)) {
    throw new Error('Non-dry-run cleanup is blocked in production unless ALLOW_PRODUCTION_CLEANUP=true.');
  }

  const cutoffMs = Date.now() - Number(env.CLEANUP_STORAGE_DAYS || 7) * 24 * 60 * 60 * 1000;
  const targets = [];
  if (bool(env.CLEANUP_TMP, true)) {
    targets.push(...(await collectFiles(path.resolve(config.rootDir, 'tmp'))).map((file) => ({ ...file, reason: 'tmp' })));
  }
  const storageFiles = [
    ...(await collectFiles(config.uploadDir)),
    ...(await collectFiles(config.outputDir)),
  ]
    .filter((file) => file.mtimeMs < cutoffMs)
    .map((file) => ({ ...file, reason: 'old_storage' }));
  targets.push(...storageFiles);

  if (!dryRun) {
    for (const file of targets) {
      assertSafePath(file.path);
      await fs.rm(file.path, { force: true });
    }
  }

  return { ok: true, dryRun, files: targets.map((file) => ({ path: file.path, reason: file.reason, size: file.size })) };
}

