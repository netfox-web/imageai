import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { config } from '../config/index.js';

export const storageRoot = path.resolve(config.rootDir, 'server/storage');

function isInsideStorage(absolutePath) {
  const root = storageRoot.toLowerCase();
  const target = absolutePath.toLowerCase();
  return target === root || target.startsWith(`${root}${path.sep}`);
}

function safeFilename(filename) {
  return path.basename(String(filename || `${Date.now()}-${randomUUID()}.bin`)).replace(/[^a-zA-Z0-9._-]/g, '-');
}

function bufferFrom(bufferOrFile) {
  if (Buffer.isBuffer(bufferOrFile)) return bufferOrFile;
  if (bufferOrFile?.buffer) return bufferOrFile.buffer;
  return Buffer.from(bufferOrFile || '');
}

export function normalizeStoragePath(storagePath) {
  const cleaned = String(storagePath || '')
    .replaceAll('\\', '/')
    .replace(/^\/+/, '');

  if (!cleaned || cleaned.includes('\0')) {
    throw storageError('Invalid storage path.');
  }

  return cleaned;
}

export function resolveStoragePath(storagePath) {
  const normalized = normalizeStoragePath(storagePath);
  const absolutePath = path.resolve(storageRoot, normalized);

  if (!isInsideStorage(absolutePath)) {
    throw storageError('Storage path is outside the allowed directory.');
  }

  return absolutePath;
}

export function ensureStorageDir(storagePath) {
  const absolutePath = resolveStoragePath(storagePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  return absolutePath;
}

export class LocalStorageAdapter {
  putUpload(file, filename = null) {
    const name = safeFilename(filename || `${Date.now()}-${randomUUID()}${path.extname(file.originalname || '.bin')}`);
    const storagePath = `uploads/${name}`;
    const absolutePath = ensureStorageDir(storagePath);
    fs.writeFileSync(absolutePath, bufferFrom(file));
    return normalizeStoragePath(storagePath);
  }

  putOutput(bufferOrFile, filename) {
    const storagePath = `outputs/${safeFilename(filename)}`;
    const absolutePath = ensureStorageDir(storagePath);
    fs.writeFileSync(absolutePath, bufferFrom(bufferOrFile));
    return normalizeStoragePath(storagePath);
  }

  getPublicUrl(storagePath) {
    return `/storage/${normalizeStoragePath(storagePath)}`;
  }

  delete(storagePath) {
    const absolutePath = resolveStoragePath(storagePath);
    if (fs.existsSync(absolutePath)) {
      fs.unlinkSync(absolutePath);
    }
  }

  exists(storagePath) {
    return fs.existsSync(resolveStoragePath(storagePath));
  }

  read(storagePath) {
    return fs.readFileSync(resolveStoragePath(storagePath));
  }
}

export function buildObjectStorageConfig(kind, overrides = {}) {
  const normalized = String(kind || 's3').toLowerCase();
  if (normalized === 'r2') {
    const accountId = overrides.accountId ?? config.r2.accountId;
    return {
      kind: 'r2',
      endpoint: overrides.endpoint || (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : ''),
      region: overrides.region || 'auto',
      bucket: overrides.bucket ?? config.r2.bucket,
      accessKeyId: overrides.accessKeyId ?? config.r2.accessKeyId,
      secretAccessKey: overrides.secretAccessKey ?? config.r2.secretAccessKey,
      forcePathStyle: true,
    };
  }

  return {
    kind: 's3',
    endpoint: overrides.endpoint ?? config.s3.endpoint,
    region: overrides.region ?? config.s3.region,
    bucket: overrides.bucket ?? config.s3.bucket,
    accessKeyId: overrides.accessKeyId ?? config.s3.accessKeyId,
    secretAccessKey: overrides.secretAccessKey ?? config.s3.secretAccessKey,
    forcePathStyle: true,
  };
}

export class ObjectStorageAdapter {
  constructor(kind, options = {}) {
    this.kind = kind;
    this.options = buildObjectStorageConfig(kind, options);
    this.client = options.client || this.createClient();
  }

  createClient() {
    this.assertConfigured();
    return new S3Client({
      region: this.options.region,
      endpoint: this.options.endpoint || undefined,
      forcePathStyle: this.options.forcePathStyle,
      credentials: {
        accessKeyId: this.options.accessKeyId,
        secretAccessKey: this.options.secretAccessKey,
      },
    });
  }

  assertConfigured() {
    const missing = [];
    if (!this.options.bucket) missing.push('bucket');
    if (!this.options.accessKeyId) missing.push('accessKeyId');
    if (!this.options.secretAccessKey) missing.push('secretAccessKey');
    if (this.kind === 'r2' && !this.options.endpoint) missing.push('R2_ACCOUNT_ID');
    if (missing.length) {
      throw storageError(`${this.kind} storage is missing required config: ${missing.join(', ')}`, 500);
    }
  }

  async putUpload(file, filename = null) {
    const name = safeFilename(filename || `${Date.now()}-${randomUUID()}${path.extname(file.originalname || '.bin')}`);
    const key = `uploads/${name}`;
    await this.putObject(key, bufferFrom(file), file.mimetype || 'application/octet-stream');
    return key;
  }

  async putOutput(bufferOrFile, filename) {
    const key = `outputs/${safeFilename(filename)}`;
    await this.putObject(key, bufferFrom(bufferOrFile), bufferOrFile?.mimetype || 'image/png');
    return key;
  }

  async putObject(key, body, contentType) {
    this.assertConfigured();
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.options.bucket,
        Key: normalizeStoragePath(key),
        Body: body,
        ContentType: contentType,
      }),
    );
  }

  getPublicUrl(storagePath) {
    const key = normalizeStoragePath(storagePath);
    const baseUrl = config.storagePublicUrl;
    if (baseUrl) return `${baseUrl.replace(/\/$/, '')}/${key}`;
    if (this.kind === 's3' && this.options.endpoint) return `${this.options.endpoint.replace(/\/$/, '')}/${this.options.bucket}/${key}`;
    return `/storage/${key}`;
  }

  async delete(storagePath) {
    this.assertConfigured();
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.options.bucket,
        Key: normalizeStoragePath(storagePath),
      }),
    );
  }

  async exists(storagePath) {
    this.assertConfigured();
    try {
      await this.client.send(
        new HeadObjectCommand({
          Bucket: this.options.bucket,
          Key: normalizeStoragePath(storagePath),
        }),
      );
      return true;
    } catch (error) {
      if (error?.$metadata?.httpStatusCode === 404 || error?.name === 'NotFound') return false;
      throw error;
    }
  }

  async read(storagePath) {
    this.assertConfigured();
    const response = await this.client.send(
      new GetObjectCommand({
        Bucket: this.options.bucket,
        Key: normalizeStoragePath(storagePath),
      }),
    );

    return streamToBuffer(response.Body);
  }
}

export function createStorageService() {
  if (['s3', 'r2'].includes(config.filesystemDisk)) {
    return new ObjectStorageAdapter(config.filesystemDisk);
  }
  return new LocalStorageAdapter();
}

export function getStorageService() {
  return createStorageService();
}

export const storageService = new Proxy(
  {},
  {
    get(_target, property) {
      const service = getStorageService();
      const value = service[property];
      return typeof value === 'function' ? value.bind(service) : value;
    },
  },
);

export function storageUrl(storagePath) {
  return getStorageService().getPublicUrl(storagePath);
}

function storageError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

async function streamToBuffer(stream) {
  if (!stream) return Buffer.alloc(0);
  if (Buffer.isBuffer(stream)) return stream;
  if (typeof stream.transformToByteArray === 'function') {
    return Buffer.from(await stream.transformToByteArray());
  }

  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}
