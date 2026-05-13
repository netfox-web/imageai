import { config } from '../config/index.js';

const buckets = new Map();

export function checkExternalApiRateLimit(sourceSystem, currentConfig = config) {
  if (!currentConfig.externalApiRateLimitEnabled) {
    return { allowed: true, remaining: Infinity };
  }
  const source = String(sourceSystem || 'unknown');
  const now = Date.now();
  const windowMs = Number(currentConfig.externalApiRateLimitWindowMs || 60000);
  const max = Number(currentConfig.externalApiRateLimitMax || 120);
  const bucket = buckets.get(source) || { resetAt: now + windowMs, count: 0 };
  if (now > bucket.resetAt) {
    bucket.resetAt = now + windowMs;
    bucket.count = 0;
  }
  bucket.count += 1;
  buckets.set(source, bucket);
  return {
    allowed: bucket.count <= max,
    remaining: Math.max(0, max - bucket.count),
    retryAfterMs: Math.max(0, bucket.resetAt - now),
  };
}

export function resetExternalApiRateLimits() {
  buckets.clear();
}
