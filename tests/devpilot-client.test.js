import { describe, expect, it, vi } from 'vitest';
import {
  buildDevPilotIdempotencyKey,
  createDevPilotHandoff,
  DevPilotHandoffClient,
  DevPilotHandoffError,
} from '../server/clients/DevPilotHandoffClient.js';
import { runDevPilotLocalIntegration } from '../server/services/DevPilotLocalIntegrationRunner.js';

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function okPayload(overrides = {}) {
  return {
    ok: true,
    handoff: { handoff_id: 42, status: 'pending' },
    idempotent_replay: false,
    execution_allowed: false,
    ...overrides,
  };
}

describe('DevPilot handoff JS client', () => {
  it('sends correct headers/body and encodes taskId with trailing-slash baseUrl', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(okPayload(), 201));
    await createDevPilotHandoff({
      baseUrl: 'http://localhost:3000/',
      sourceSystem: 'external-system-a',
      apiKey: 'devpilot-secret-key',
      fetchImpl,
      taskId: 'task/123',
      reason: 'Manual review',
      nextStep: 'Review ticket',
      externalRef: 'ticket-123',
      requestId: 'request-1',
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, options] = fetchImpl.mock.calls[0];
    expect(url).toBe('http://localhost:3000/api/external/tasks/task%2F123/handoffs');
    expect(options.method).toBe('POST');
    expect(options.headers['X-DevPilot-Source-System']).toBe('external-system-a');
    expect(options.headers['X-DevPilot-Api-Key']).toBe('devpilot-secret-key');
    expect(options.headers['X-DevPilot-Request-Id']).toBe('request-1');
    expect(options.headers['X-DevPilot-Idempotency-Key']).toBe('external-system-a:task/123:ticket-123:handoff');
    expect(JSON.parse(options.body)).toMatchObject({
      from_agent: 'external-system-a',
      to_agent: 'devpilot-reviewer',
      reason: 'Manual review',
      next_step: 'Review ticket',
      risk: 'low',
      external_ref: 'ticket-123',
      actor_type: 'system',
      actor_id: 'external-system-a',
    });
  });

  it('builds a stable idempotency key and allows override', async () => {
    const stableA = buildDevPilotIdempotencyKey({
      taskId: 7,
      sourceSystem: 'source-a',
      payload: { external_ref: 'ticket-7', reason: 'A' },
    });
    const stableB = buildDevPilotIdempotencyKey({
      taskId: 7,
      sourceSystem: 'source-a',
      payload: { external_ref: 'ticket-7', reason: 'B' },
    });
    expect(stableA).toBe('source-a:7:ticket-7:handoff');
    expect(stableB).toBe(stableA);

    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(okPayload(), 201));
    const client = new DevPilotHandoffClient({
      baseUrl: 'https://devpilot.test',
      sourceSystem: 'source-a',
      apiKey: 'key-a',
      fetchImpl,
    });
    await client.createHandoff(7, {
      from_agent: 'source-a',
      to_agent: 'devpilot-reviewer',
      reason: 'Manual review',
      next_step: 'Review',
      risk: 'medium',
      external_ref: 'ticket-7',
    }, {
      requestId: 'request-override',
      idempotencyKey: 'custom-idempotency-key',
    });
    expect(fetchImpl.mock.calls[0][1].headers['X-DevPilot-Idempotency-Key']).toBe('custom-idempotency-key');
  });

  it('normalizes 201 create and 200 idempotent replay responses', async () => {
    const createFetch = vi.fn().mockResolvedValue(jsonResponse(okPayload({ handoff: { handoff_id: 1 } }), 201));
    const client = new DevPilotHandoffClient({ baseUrl: 'https://devpilot.test', sourceSystem: 's', apiKey: 'k', fetchImpl: createFetch });
    const created = await client.createHandoff(1, { from_agent: 's', to_agent: 'r', reason: 'r', next_step: 'n', external_ref: 'e' });
    expect(created).toEqual({ ok: true, handoff: { handoff_id: 1 }, idempotentReplay: false, executionAllowed: false });

    const replayFetch = vi.fn().mockResolvedValue(jsonResponse(okPayload({
      handoff: { handoff_id: 1 },
      idempotent_replay: true,
    }), 200));
    const replayClient = new DevPilotHandoffClient({ baseUrl: 'https://devpilot.test', sourceSystem: 's', apiKey: 'k', fetchImpl: replayFetch });
    const replay = await replayClient.createHandoff(1, { from_agent: 's', to_agent: 'r', reason: 'r', next_step: 'n', external_ref: 'e' });
    expect(replay.idempotentReplay).toBe(true);
    expect(replay.executionAllowed).toBe(false);
  });

  it('maps 403 without leaking the API key or using data.error as code', async () => {
    const apiKey = 'very-secret-devpilot-key';
    const fetchImpl = vi.fn().mockImplementation(() => Promise.resolve(jsonResponse({
      ok: false,
      error: `Invalid API key ${apiKey}`,
    }, 403)));
    const client = new DevPilotHandoffClient({ baseUrl: 'https://devpilot.test', sourceSystem: 's', apiKey, fetchImpl });

    await expect(client.createHandoff(1, { from_agent: 's', to_agent: 'r', reason: 'r', next_step: 'n', external_ref: 'e' }))
      .rejects
      .toMatchObject({
        name: 'DevPilotHandoffError',
        status: 403,
        code: 'forbidden',
        retryable: false,
      });

    try {
      await client.createHandoff(1, { from_agent: 's', to_agent: 'r', reason: 'r', next_step: 'n', external_ref: 'e' });
    } catch (error) {
      expect(error).toBeInstanceOf(DevPilotHandoffError);
      expect(error.message).not.toContain(apiKey);
      expect(JSON.stringify(error)).not.toContain(apiKey);
      expect(error.code).toBe('forbidden');
    }
  });

  it('marks 429 and 5xx retryable while 400 and 404 are non-retryable', async () => {
    for (const [status, code, retryable] of [
      [429, 'rate_limited', true],
      [500, 'server_error', true],
      [503, 'server_error', true],
      [400, 'invalid_request', false],
      [404, 'not_found', false],
    ]) {
      const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ ok: false, error: `status ${status}` }, status));
      const client = new DevPilotHandoffClient({ baseUrl: 'https://devpilot.test', sourceSystem: 's', apiKey: 'k', fetchImpl });
      try {
        await client.createHandoff(1, { from_agent: 's', to_agent: 'r', reason: 'r', next_step: 'n', external_ref: 'e' });
        throw new Error('Expected request to fail.');
      } catch (error) {
        expect(error).toBeInstanceOf(DevPilotHandoffError);
        expect(error.status).toBe(status);
        expect(error.code).toBe(code);
        expect(error.retryable).toBe(retryable);
      }
    }
  });

  it('marks timeout as retryable', async () => {
    const fetchImpl = vi.fn((_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => {
        const error = new Error('aborted');
        error.name = 'AbortError';
        reject(error);
      });
    }));
    const client = new DevPilotHandoffClient({
      baseUrl: 'https://devpilot.test',
      sourceSystem: 's',
      apiKey: 'k',
      fetchImpl,
      timeoutMs: 1,
    });

    await expect(client.createHandoff(1, { from_agent: 's', to_agent: 'r', reason: 'r', next_step: 'n', external_ref: 'e' }))
      .rejects
      .toMatchObject({
        name: 'DevPilotHandoffError',
        status: 408,
        code: 'timeout',
        retryable: true,
      });
  });

  it('local integration runner exercises create, replay, list, detail, and isolation without leaking keys', async () => {
    const handoff = {
      handoff_id: 88,
      source_system: 'external-system-a',
      status: 'pending',
      execution_allowed: false,
    };
    const fetchImpl = vi.fn(async (url, options = {}) => {
      const parsed = new URL(url);
      const source = options.headers['X-DevPilot-Source-System'];
      if (parsed.pathname.endsWith('/handoffs') && options.method === 'POST') {
        const isReplay = fetchImpl.mock.calls.filter(([calledUrl, calledOptions]) => calledUrl === url && calledOptions?.method === 'POST').length > 1;
        return jsonResponse(okPayload({ handoff, idempotent_replay: isReplay }), isReplay ? 200 : 201);
      }
      if (parsed.pathname === '/api/external/ai-handoffs') {
        return jsonResponse({ ok: true, handoffs: [handoff], total: 1, limit: 50, offset: 0 }, 200);
      }
      if (parsed.pathname === '/api/external/handoffs/88') {
        if (source === 'external-system-b') return jsonResponse({ ok: false, error: 'Handoff not found.' }, 404);
        return jsonResponse({ ok: true, handoff }, 200);
      }
      return jsonResponse({ ok: false, error: 'unexpected route' }, 500);
    });

    const result = await runDevPilotLocalIntegration({
      DEVPILOT_API_BASE_URL: 'http://localhost:3000/',
      DEVPILOT_SOURCE_SYSTEM: 'external-system-a',
      DEVPILOT_API_KEY: 'dev-key-a',
      DEVPILOT_SECOND_SOURCE_SYSTEM: 'external-system-b',
      DEVPILOT_SECOND_API_KEY: 'dev-key-b',
      DEVPILOT_TASK_ID: '123',
      DEVPILOT_EXTERNAL_REF: 'ticket-123',
    }, { fetchImpl });

    expect(result.ok).toBe(true);
    expect(result.handoffId).toBe(88);
    expect(result.idempotentReplay).toBe(true);
    expect(result.sourceIsolationStatus).toBe(404);
    expect(JSON.stringify(result)).not.toContain('dev-key-a');
    expect(fetchImpl).toHaveBeenCalledTimes(5);
  });
});
