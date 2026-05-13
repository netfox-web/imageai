import fs from 'node:fs/promises';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import { config } from '../config/index.js';
import { closeDatabase, initDatabase } from '../db/database.js';
import { migrate } from '../db/migrations.js';
import { ensureAdmin, seed } from '../db/seeders.js';

function assertNonProduction(env = process.env) {
  const nodeEnv = env.NODE_ENV || config.nodeEnv;
  const appEnv = env.APP_ENV || config.appEnv || nodeEnv;
  if (nodeEnv === 'production' || appEnv === 'production') {
    throw new Error('dev:reset is blocked in production.');
  }
}

function assertSafePath(targetPath, label) {
  const resolved = path.resolve(targetPath);
  const allowedRoots = [
    path.resolve(config.rootDir, 'server/storage'),
    path.resolve(config.rootDir, 'tmp'),
  ];
  const safe = allowedRoots.some((root) => {
    const relative = path.relative(root, resolved);
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
  });
  if (!safe) {
    throw new Error(`Refusing to clean unsafe ${label} path: ${resolved}`);
  }
  return resolved;
}

async function removeIfExists(targetPath, label) {
  const safePath = assertSafePath(targetPath, label);
  await fs.rm(safePath, { recursive: true, force: true });
  return safePath;
}

export async function runDevReset(env = process.env) {
  assertNonProduction(env);
  closeDatabase();

  const cleaned = [];
  if (config.databasePath !== ':memory:') {
    cleaned.push(await removeIfExists(config.databasePath, 'database'));
  }
  cleaned.push(await removeIfExists(config.uploadDir, 'uploads'));
  cleaned.push(await removeIfExists(config.outputDir, 'outputs'));

  await initDatabase();
  await migrate();
  await seed();
  const email = env.ADMIN_EMAIL || 'admin@example.com';
  const password = env.ADMIN_PASSWORD || 'password123';
  const hash = await bcrypt.hash(password, 10);
  ensureAdmin(email, hash, env.ADMIN_NAME || 'Admin');
  closeDatabase();

  return { ok: true, cleaned, adminEmail: email };
}

