import { createHash, randomUUID } from 'node:crypto';

const DEFAULT_TIMEOUT_MS = 15_000;

export class DevPilotHandoffError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = 'DevPilotHandoffError';
    this.status = options.status ?? 0;
    this.code = options.code || mapStatusCode(this.status);
    this.retryable = Boolean(options.retryable ?? isRetryableStatus(this.status));
    this.requestId = options.requestId || null;
    this.details = options.details || null;
    if (options.cause) this.cause = options.cause;
  }

  toJSON() {
    return {
      name: this.name,
      message: this.message,
      status: this.status,
      code: this.code,
      retryable: this.retryable,
      requestId: this.requestId,
      details: this.details,
    };
  }
}

export function buildDevPilotIdempotencyKey({ taskId, sourceSystem = '', payload = {} } = {}) {
  const externalRef = String(payload.external_ref || payload.externalRef || '');
  if (externalRef) {
    return `${sourceSystem}:${String(taskId ?? '')}:${externalRef}:handoff`;
  }
  const stablePayload = {
    taskId: String(taskId ?? ''),
    sourceSystem: String(sourceSystem || payload.from_agent || ''),
    fromAgent: String(payload.from_agent || ''),
    toAgent: String(payload.to_agent || ''),
    externalRef,
    reason: String(payload.reason || ''),
    nextStep: String(payload.next_step || ''),
    risk: String(payload.risk_level || payload.risk || ''),
  };
  const digest = createHash('sha256').update(JSON.stringify(stablePayload)).digest('hex').slice(0, 32);
  return `devpilot-handoff-${digest}`;
}

export class DevPilotHandoffClient {
  constructor({
    baseUrl,
    apiKey,
    sourceSystem,
    fetchImpl = globalThis.fetch,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  } = {}) {
    if (!baseUrl) throw new DevPilotHandoffError('baseUrl is required.', { status: 400, code: 'invalid_config', retryable: false });
    if (!apiKey) throw new DevPilotHandoffError('apiKey is required.', { status: 400, code: 'invalid_config', retryable: false });
    if (!sourceSystem) throw new DevPilotHandoffError('sourceSystem is required.', { status: 400, code: 'invalid_config', retryable: false });
    if (typeof fetchImpl !== 'function') throw new DevPilotHandoffError('fetch implementation is required.', { status: 400, code: 'invalid_config', retryable: false });
    this.baseUrl = String(baseUrl).replace(/\/+$/, '');
    this.apiKey = String(apiKey);
    this.sourceSystem = String(sourceSystem);
    this.fetchImpl = fetchImpl;
    this.timeoutMs = Number(timeoutMs || DEFAULT_TIMEOUT_MS);
  }

  async createHandoff(taskId, payload = {}, options = {}) {
    const requestId = options.requestId || randomUUID();
    const idempotencyKey = options.idempotencyKey || buildDevPilotIdempotencyKey({
      taskId,
      sourceSystem: this.sourceSystem,
      payload,
    });
    const data = await this.request(`/api/external/tasks/${encodeURIComponent(String(taskId))}/handoffs`, {
      method: 'POST',
      requestId,
      idempotencyKey,
      body: payload,
      timeoutMs: options.timeoutMs,
    });
    return normalizeCreateHandoffResponse(data);
  }

  async listHandoffs(filters = {}, options = {}) {
    const query = new URLSearchParams(Object.entries(filters).filter(([, value]) => value !== undefined && value !== null && value !== ''));
    const suffix = query.toString() ? `?${query.toString()}` : '';
    return this.request(`/api/external/ai-handoffs${suffix}`, {
      method: 'GET',
      requestId: options.requestId,
      timeoutMs: options.timeoutMs,
    });
  }

  async getHandoff(handoffId, options = {}) {
    return this.request(`/api/external/handoffs/${encodeURIComponent(String(handoffId))}`, {
      method: 'GET',
      requestId: options.requestId,
      timeoutMs: options.timeoutMs,
    });
  }

  async request(path, options = {}) {
    const requestId = options.requestId || randomUUID();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Number(options.timeoutMs || this.timeoutMs));
    const headers = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-DevPilot-Source-System': this.sourceSystem,
      'X-DevPilot-Api-Key': this.apiKey,
      ...(requestId ? { 'X-DevPilot-Request-Id': requestId } : {}),
      ...(options.idempotencyKey ? { 'X-DevPilot-Idempotency-Key': options.idempotencyKey } : {}),
    };
    try {
      const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method: options.method || 'GET',
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: controller.signal,
      });
      const data = await readJson(response);
      if (!response.ok) {
        throw createHttpError(response.status, data, {
          requestId,
          apiKey: this.apiKey,
        });
      }
      return data;
    } catch (error) {
      if (error instanceof DevPilotHandoffError) throw error;
      const isTimeout = error?.name === 'AbortError';
      throw new DevPilotHandoffError(isTimeout ? 'Request timed out.' : 'Network request failed.', {
        status: isTimeout ? 408 : 0,
        code: isTimeout ? 'timeout' : 'network_error',
        retryable: true,
        requestId,
        cause: error,
      });
    } finally {
      clearTimeout(timeout);
    }
  }
}

export async function createDevPilotHandoff({
  taskId,
  reason,
  nextStep,
  externalRef,
  risk = 'low',
  timeoutMs = DEFAULT_TIMEOUT_MS,
  requestId,
  idempotencyKey,
  baseUrl = process.env.DEVPILOT_API_BASE_URL,
  sourceSystem = process.env.DEVPILOT_SOURCE_SYSTEM,
  apiKey = process.env.DEVPILOT_API_KEY,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (!taskId) throw new DevPilotHandoffError('Missing taskId.', { status: 400, code: 'invalid_config', retryable: false });
  if (!externalRef || typeof externalRef !== 'string') throw new DevPilotHandoffError('Missing externalRef.', { status: 400, code: 'invalid_config', retryable: false });
  if (!reason || typeof reason !== 'string') throw new DevPilotHandoffError('Missing reason.', { status: 400, code: 'invalid_config', retryable: false });
  if (!nextStep || typeof nextStep !== 'string') throw new DevPilotHandoffError('Missing nextStep.', { status: 400, code: 'invalid_config', retryable: false });
  if (!['low', 'medium', 'high'].includes(risk)) {
    throw new DevPilotHandoffError('Invalid risk; expected low, medium, or high.', { status: 400, code: 'invalid_config', retryable: false });
  }
  const client = new DevPilotHandoffClient({ baseUrl, sourceSystem, apiKey, fetchImpl, timeoutMs });
  return client.createHandoff(taskId, {
    from_agent: sourceSystem,
    to_agent: 'devpilot-reviewer',
    reason,
    next_step: nextStep,
    risk,
    external_ref: externalRef,
    actor_type: 'system',
    actor_id: sourceSystem,
  }, {
    requestId,
    idempotencyKey,
    timeoutMs,
  });
}

export function normalizeCreateHandoffResponse(data = {}) {
  return {
    ok: Boolean(data.ok),
    handoff: data.handoff || null,
    idempotentReplay: Boolean(data.idempotent_replay),
    executionAllowed: Boolean(data.execution_allowed),
  };
}

function createHttpError(status, data = {}, { requestId, apiKey } = {}) {
  const code = mapStatusCode(status);
  const retryable = isRetryableStatus(status);
  const serverMessage = typeof data?.error === 'string' ? data.error : '';
  const message = redactSecret(serverMessage || defaultMessageForStatus(status), apiKey);
  return new DevPilotHandoffError(message, {
    status,
    code,
    retryable,
    requestId,
    details: sanitizeErrorDetails(data, apiKey),
  });
}

function mapStatusCode(status) {
  if (status === 400) return 'invalid_request';
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  if (status === 408) return 'timeout';
  if (status === 409) return 'conflict';
  if (status === 429) return 'rate_limited';
  if (status >= 500) return 'server_error';
  return status ? 'http_error' : 'network_error';
}

function isRetryableStatus(status) {
  return status === 0 || status === 408 || status === 429 || status >= 500;
}

function defaultMessageForStatus(status) {
  if (status === 400) return 'Invalid request.';
  if (status === 403) return 'Forbidden.';
  if (status === 404) return 'Not found.';
  if (status === 429) return 'Rate limited.';
  if (status >= 500) return 'Server error.';
  return 'DevPilot handoff request failed.';
}

function sanitizeErrorDetails(value, apiKey) {
  if (!value || typeof value !== 'object') return null;
  return JSON.parse(JSON.stringify(value, (_key, item) => {
    if (typeof item !== 'string') return item;
    return redactSecret(item, apiKey);
  }));
}

function redactSecret(value = '', apiKey = '') {
  let text = String(value);
  if (apiKey) text = text.split(apiKey).join('[redacted_api_key]');
  return text.replace(/sk-[A-Za-z0-9_-]{8,}/g, '[redacted_api_key]');
}

async function readJson(response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { error: 'Invalid JSON response.' };
  }
}

export default DevPilotHandoffClient;
