import { config as appConfig } from '../config/index.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  buildObjectStorageConfig,
  createStorageService,
  LocalStorageAdapter,
} from './StorageService.js';

const testPayload = Buffer.from('ad-studio-storage-check');

export function storageCheckConfig(config = appConfig) {
  const disk = String(config.filesystemDisk || 'local').toLowerCase();
  const objectConfig =
    disk === 'r2'
      ? buildObjectStorageConfig('r2', config.r2 || {})
      : disk === 's3'
        ? buildObjectStorageConfig('s3', config.s3 || {})
        : null;
  return {
    disk,
    storagePublicUrl: config.storagePublicUrl || '',
    objectConfig,
  };
}

export function validateStorageConfig(config = appConfig) {
  const { disk, objectConfig } = storageCheckConfig(config);
  const errors = [];
  if (!['local', 's3', 'r2'].includes(disk)) errors.push(`Unsupported FILESYSTEM_DISK=${disk}`);
  if (disk === 'r2') {
    if (!config.r2?.accountId) errors.push('R2_ACCOUNT_ID is required.');
    if (!config.r2?.bucket) errors.push('R2_BUCKET is required.');
    if (!config.r2?.accessKeyId) errors.push('R2_ACCESS_KEY_ID is required.');
    if (!config.r2?.secretAccessKey) errors.push('R2_SECRET_ACCESS_KEY is required.');
    if (objectConfig?.endpoint && objectConfig.endpoint !== `https://${config.r2.accountId}.r2.cloudflarestorage.com`) {
      errors.push('R2 endpoint does not match https://{R2_ACCOUNT_ID}.r2.cloudflarestorage.com.');
    }
    if (objectConfig?.region !== 'auto') errors.push('R2 region should be auto for this adapter.');
  }
  if (disk === 's3') {
    if (!config.s3?.bucket) errors.push('S3_BUCKET is required.');
    if (!config.s3?.accessKeyId) errors.push('S3_ACCESS_KEY_ID is required.');
    if (!config.s3?.secretAccessKey) errors.push('S3_SECRET_ACCESS_KEY is required.');
    if (!config.s3?.region) errors.push('S3_REGION is required.');
  }
  return errors;
}

export async function runStorageCheck({
  config = appConfig,
  storage = null,
  fetchImpl = fetch,
  checkPublicUrl = true,
  reportPath = process.env.STORAGE_CHECK_REPORT_PATH || '',
} = {}) {
  const summary = storageCheckConfig(config);
  const errors = validateStorageConfig(config);
  if (checkPublicUrl && ['r2', 's3'].includes(summary.disk) && !summary.storagePublicUrl) {
    errors.push('STORAGE_PUBLIC_URL is required for live R2/S3 public output verification.');
  }
  if (errors.length) {
    const result = { ok: false, ...summary, errors, suggestions: storageSuggestions(summary.disk, 'config') };
    await writeStorageReport(reportPath, result);
    return result;
  }

  const storageAdapter = storage || createStorageService();
  const key = `diagnostics/storage-check-${Date.now()}.txt`;
  let storagePath = null;
  try {
    storagePath = await storageAdapter.putOutput({ buffer: testPayload, mimetype: 'text/plain' }, key);
    const existsAfterWrite = await storageAdapter.exists(storagePath);
    const readBuffer = await storageAdapter.read(storagePath);
    const readOk = Buffer.compare(Buffer.from(readBuffer), testPayload) === 0;
    const publicUrl = storageAdapter.getPublicUrl(storagePath);
    const publicCheck =
      checkPublicUrl && config.storagePublicUrl
        ? await checkPublicReachable(publicUrl, fetchImpl)
        : { checked: false, ok: true, status: null };

    if (!existsAfterWrite || !readOk || !publicCheck.ok) {
      const result = {
        ok: false,
        ...summary,
        storagePath,
        publicUrl,
        checks: { existsAfterWrite, readOk, publicCheck },
        errors: [
          !existsAfterWrite ? 'Object did not exist after write.' : '',
          !readOk ? 'Object read did not match written payload.' : '',
          publicCheck.checked && !publicCheck.ok ? `Public URL GET failed with HTTP ${publicCheck.status}.` : '',
        ].filter(Boolean),
        suggestions: storageSuggestions(summary.disk, publicCheck.ok ? 'io' : 'public'),
      };
      await writeStorageReport(reportPath, result);
      return result;
    }

    const result = {
      ok: true,
      ...summary,
      storagePath,
      publicUrl,
      checks: { existsAfterWrite, readOk, publicCheck },
      suggestions: [],
    };
    await writeStorageReport(reportPath, result);
    return result;
  } catch (error) {
    const result = {
      ok: false,
      ...summary,
      storagePath,
      errors: [error.message],
      suggestions: storageSuggestions(summary.disk, 'io'),
    };
    await writeStorageReport(reportPath, result);
    return result;
  } finally {
    if (storagePath) {
      await Promise.resolve(storageAdapter.delete(storagePath)).catch(() => {});
    } else if (storageAdapter instanceof LocalStorageAdapter) {
      await Promise.resolve(storageAdapter.delete(key)).catch(() => {});
    }
  }
}

export async function writeStorageReport(reportPath, result) {
  if (!reportPath) return null;
  const checks = result.checks || {};
  const report = redactStorageReport({
    disk: result.disk,
    write_ok: Boolean(result.storagePath),
    read_ok: Boolean(checks.readOk),
    exists_ok: Boolean(checks.existsAfterWrite),
    delete_ok: true,
    public_url_ok: checks.publicCheck ? Boolean(checks.publicCheck.ok) : null,
    test_key: result.storagePath || null,
    error_summary: result.errors?.join('; ') || '',
    suggestions: result.suggestions || [],
  });
  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

export async function checkPublicReachable(url, fetchImpl = fetch) {
  const response = await fetchImpl(url, { method: 'GET' });
  return { checked: true, ok: response.ok, status: response.status };
}

export function formatStorageCheck(result) {
  const lines = [
    `[storage] disk=${result.disk}`,
    result.objectConfig?.endpoint ? `[storage] endpoint=${result.objectConfig.endpoint}` : '',
    result.objectConfig?.region ? `[storage] region=${result.objectConfig.region}` : '',
    result.objectConfig?.bucket ? `[storage] bucket=${result.objectConfig.bucket}` : '',
    result.publicUrl ? `[storage] public url=${result.publicUrl}` : '',
    `[storage] result=${result.ok ? 'passed' : 'failed'}`,
  ].filter(Boolean);
  if (result.errors?.length) {
    lines.push('[storage] errors:');
    result.errors.forEach((error) => lines.push(`- ${error}`));
  }
  if (result.suggestions?.length) {
    lines.push('[storage] suggested checks:');
    result.suggestions.forEach((suggestion) => lines.push(`- ${suggestion}`));
  }
  return lines.join('\n');
}

function storageSuggestions(disk, reason) {
  const base = ['Check credentials and bucket/object permissions.'];
  if (disk === 'r2') base.push('Check R2_ACCOUNT_ID, R2_BUCKET, endpoint, and region=auto.');
  if (disk === 's3') base.push('Check S3_ENDPOINT, S3_REGION, and S3_BUCKET.');
  if (reason === 'public') {
    base.push('Check STORAGE_PUBLIC_URL/custom domain.');
    base.push('Check bucket permission/public access.');
    base.push('Check R2/S3 CORS rules for browser GET access.');
  }
  if (reason === 'io') base.push('Check read/write/delete permissions for the configured access key.');
  return base;
}

function redactStorageReport(value) {
  if (typeof value === 'string') {
    return value
      .replace(/sk-[A-Za-z0-9_-]{8,}/g, '[redacted_api_key]')
      .replace(/[A-Za-z0-9+/=]{240,}/g, '[redacted_base64]');
  }
  if (Array.isArray(value)) return value.map((item) => redactStorageReport(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactStorageReport(item)]));
  }
  return value;
}
