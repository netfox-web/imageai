import { timingSafeEqual } from 'node:crypto';
import { config } from '../config/index.js';
import { countActiveDevPilotExternalKeys, verifyDevPilotExternalKey } from './DevPilotExternalKeyService.js';

export class ExternalApiError extends Error {
  constructor(message, status = 403) {
    super(message);
    this.status = status;
  }
}

function parseKeyPairs(raw = '') {
  return String(raw || '')
    .split(',')
    .map((pair) => pair.trim())
    .filter(Boolean)
    .map((pair) => {
      const separator = pair.indexOf(':');
      if (separator <= 0) return null;
      return {
        source: pair.slice(0, separator).trim(),
        key: pair.slice(separator + 1).trim(),
      };
    })
    .filter((item) => item?.source && item.key);
}

function safeEqual(a = '', b = '') {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function configuredExternalApiSources(currentConfig = config) {
  return parseKeyPairs(currentConfig.devpilotExternalApiKeysRaw);
}

export function authenticateExternalApiRequest(req, currentConfig = config) {
  const configured = configuredExternalApiSources(currentConfig);
  const activeDbKeyCount = countActiveDevPilotExternalKeys();
  if (!configured.length && activeDbKeyCount === 0) {
    throw new ExternalApiError('External API is disabled.', 403);
  }

  const sourceSystem = String(req.get('x-devpilot-source-system') || '').trim();
  const apiKey = String(req.get('x-devpilot-api-key') || '');
  if (!sourceSystem) throw new ExternalApiError('Missing X-DevPilot-Source-System header.', 403);
  if (!apiKey) throw new ExternalApiError('Missing X-DevPilot-Api-Key header.', 403);

  const match = configured.find((item) => item.source === sourceSystem);
  if (match && safeEqual(apiKey, match.key)) {
    return {
      sourceSystem,
      requestId: String(req.get('x-devpilot-request-id') || '').trim() || null,
      idempotencyKey: String(req.get('x-devpilot-idempotency-key') || '').trim() || null,
      allowAllSources: Boolean(currentConfig.devpilotExternalApiAllowAllSources),
    };
  }

  const dbMatch = verifyDevPilotExternalKey(sourceSystem, apiKey);
  if (dbMatch.matched) {
    return {
      sourceSystem,
      requestId: String(req.get('x-devpilot-request-id') || '').trim() || null,
      idempotencyKey: String(req.get('x-devpilot-idempotency-key') || '').trim() || null,
      allowAllSources: Boolean(currentConfig.devpilotExternalApiAllowAllSources),
    };
  }

  if (!match && !dbMatch.sourceExists) throw new ExternalApiError('Unknown source system.', 403);
  throw new ExternalApiError('Invalid API key.', 403);
}

export const externalApiAuthService = {
  authenticateExternalApiRequest,
  configuredExternalApiSources,
};
