import fs from 'node:fs/promises';
import path from 'node:path';

const defaultPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p94AAAAASUVORK5CYII=',
  'base64',
);

export class SmokeTestError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'SmokeTestError';
    this.step = details.step || 'unknown';
    this.status = details.status || null;
    this.bodySummary = details.bodySummary || '';
    this.taskId = details.taskId || null;
    this.suggestions = details.suggestions || suggestionsForStep(this.step);
  }
}

export function parseSmokeEnv(env = process.env) {
  return {
    baseUrl: String(env.SMOKE_BASE_URL || env.APP_URL || 'http://localhost:3000').replace(/\/$/, ''),
    email: env.SMOKE_EMAIL || `smoke-${Date.now()}@example.com`,
    password: env.SMOKE_PASSWORD || 'password123',
    imagePath: env.SMOKE_IMAGE_PATH || '',
    imageUrl: env.SMOKE_IMAGE_URL || '',
    timeoutMs: Number(env.SMOKE_TIMEOUT_MS || 90000),
    pollIntervalMs: Number(env.SMOKE_POLL_INTERVAL_MS || 3000),
    expectProvider: env.SMOKE_EXPECT_PROVIDER || '',
    expectStorageDisk: env.SMOKE_EXPECT_STORAGE_DISK || '',
    reportPath: env.SMOKE_REPORT_PATH || '',
  };
}

export async function loadSmokeImage(options = {}, fetchImpl = fetch) {
  if (options.imagePath) {
    return fs.readFile(options.imagePath);
  }
  if (options.imageUrl) {
    const response = await fetchImpl(options.imageUrl);
    if (!response.ok) {
      throw new SmokeTestError(`Could not download smoke image: ${response.status}`, {
        step: 'load image',
        status: response.status,
        bodySummary: await safeResponseSummary(response),
      });
    }
    return Buffer.from(await response.arrayBuffer());
  }
  return defaultPng;
}

export async function verifyOutputUrls(urls, { fetchImpl = fetch, baseUrl = '', headers = {} } = {}) {
  const results = [];
  for (const url of urls.filter(Boolean)) {
    const absoluteUrl = url.startsWith('http') ? url : `${baseUrl.replace(/\/$/, '')}${url}`;
    const response = await fetchImpl(absoluteUrl, { method: 'GET', headers });
    const ok = response.ok;
    results.push({ url: absoluteUrl, ok, status: response.status });
    if (!ok) {
      throw new SmokeTestError('Output URL is not reachable.', {
        step: 'verify output urls',
        status: response.status,
        bodySummary: await safeResponseSummary(response),
        suggestions: [
          'Check STORAGE_PUBLIC_URL and custom domain.',
          'Check R2/S3 bucket public access or CORS.',
          'If using /storage/*, make sure auth cookies are available.',
        ],
      });
    }
  }
  return results;
}

export async function runSmokeTest(options = {}, deps = {}) {
  const config = { ...parseSmokeEnv({}), ...options };
  const fetchImpl = deps.fetchImpl || fetch;
  const log = deps.log || (() => {});
  const jar = new Map();
  const startedAt = new Date();
  const startedMs = Date.now();
  let taskId = null;
  let task = null;
  let metadata = {};
  let outputUrls = [];
  let urlChecks = [];

  const request = async (step, path, requestOptions = {}) => {
    const headers = {
      ...(cookieHeader(jar) ? { cookie: cookieHeader(jar) } : {}),
      ...(requestOptions.headers || {}),
    };
    let response;
    try {
      response = await fetchImpl(`${config.baseUrl}${path}`, { ...requestOptions, headers });
    } catch (error) {
      throw new SmokeTestError(`${step} failed: ${error.message}`, {
        step,
        taskId,
        suggestions: suggestionsForStep(step),
      });
    }
    storeCookies(response, jar);
    const text = await response.text();
    const body = parseMaybeJson(text);
    if (!response.ok) {
      throw new SmokeTestError(`${step} failed with HTTP ${response.status}`, {
        step,
        status: response.status,
        bodySummary: summarizeBody(body),
        taskId,
      });
    }
    return body;
  };

  try {
    log('health check');
    const session = await request('health check', '/api/session');
    const csrf = session.csrfToken;

    log('register/login');
    let auth;
    try {
      auth = await request('register', '/api/auth/register', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-csrf-token': csrf },
        body: JSON.stringify({ name: 'Smoke User', email: config.email, password: config.password, terms: true }),
      });
    } catch (error) {
      if (!(error instanceof SmokeTestError)) throw error;
      auth = await request('login', '/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-csrf-token': csrf },
        body: JSON.stringify({ email: config.email, password: config.password }),
      });
    }

    log(`authenticated ${auth.user?.email || config.email}`);
    const bootstrap = await request('bootstrap', '/api/bootstrap');
    const format = bootstrap.platformFormats?.find((item) => item.platform_key === 'facebook') || bootstrap.platformFormats?.[0];
    if (!format) throw new SmokeTestError('No platform format returned from bootstrap.', { step: 'bootstrap' });

    const image = await loadSmokeImage(config, fetchImpl);
    const imageBlob = new Blob([image], { type: 'image/png' });

    log('upload/analyze product image');
    const analyzeForm = new FormData();
    analyzeForm.append('images', imageBlob, 'product.png');
    analyzeForm.append('language', 'zh-TW');
    const analyze = await request('analyze product image', '/studio/analyze', {
      method: 'POST',
      headers: { 'x-csrf-token': csrf },
      body: analyzeForm,
    });

    log('create generation task');
    const taskForm = new FormData();
    taskForm.append('images', imageBlob, 'product.png');
    taskForm.append('tool_type', 'banner');
    taskForm.append('style_key', 'minimal');
    taskForm.append('text_mode', 'merged');
    taskForm.append('image_size', '2K');
    taskForm.append('quantity', '1');
    taskForm.append('product_name', analyze.productName || 'Smoke Product');
    taskForm.append('main_title', analyze.title || 'Smoke Title');
    taskForm.append('subtitle', analyze.subtitle || 'Smoke Subtitle');
    taskForm.append('custom_prompt', analyze.customPrompt || 'Clean ecommerce smoke test banner.');
    taskForm.append('platform_format_ids', JSON.stringify([format.id]));
    taskForm.append('custom_formats', JSON.stringify([]));
    taskForm.append('input_roles', JSON.stringify(['cover']));

    const created = await request('create generation task', '/studio/tasks', {
      method: 'POST',
      headers: { 'x-csrf-token': csrf },
      body: taskForm,
    });
    taskId = created.task_id;

    log(`poll task #${taskId}`);
    const started = Date.now();
    while (Date.now() - started < config.timeoutMs) {
      task = (await request('poll task', `/api/tasks/${taskId}`)).task;
      log(`task #${task.id} status=${task.status}`);
      if (['success', 'failed'].includes(task.status)) break;
      await new Promise((resolve) => setTimeout(resolve, config.pollIntervalMs));
    }

    if (!task || !['success', 'failed'].includes(task.status)) {
      throw new SmokeTestError(`Task did not finish within ${config.timeoutMs}ms.`, {
        step: 'poll task',
        taskId,
        suggestions: ['Check worker process and QUEUE_DRIVER.', 'Check provider latency and task error logs.'],
      });
    }

    metadata = parseTaskMetadata(task.ai_cost_logs?.[0]);
    log(`metadata provider=${metadata.provider || '-'} model=${metadata.model || '-'} images=${metadata.image_count || 0} latency=${metadata.latency_ms ?? '-'}ms cost=${metadata.cost ?? '-'}`);
    if (task.status === 'failed') {
      throw new SmokeTestError(`Task failed: ${task.error_message || metadata.error_message || 'unknown error'}`, {
        step: 'verify completed/failed',
        taskId,
        bodySummary: JSON.stringify({ error_code: metadata.error_code, error_message: metadata.error_message }).slice(0, 500),
        suggestions: suggestionsForStep('provider failed'),
      });
    }

    if (config.expectProvider && metadata.provider !== config.expectProvider) {
      throw new SmokeTestError(`Expected provider ${config.expectProvider}, got ${metadata.provider || 'unknown'}.`, {
        step: 'verify metadata',
        taskId,
      });
    }
    if (config.expectStorageDisk && metadata.storage_disk && metadata.storage_disk !== config.expectStorageDisk) {
      throw new SmokeTestError(`Expected storage disk ${config.expectStorageDisk}, got ${metadata.storage_disk}.`, {
        step: 'verify metadata',
        taskId,
      });
    }

    log('verify output URLs reachable');
    outputUrls = task.output_images?.map((imageRow) => imageRow.url) || [];
    if (!outputUrls.length) {
      throw new SmokeTestError('Task succeeded but returned no output image URLs.', { step: 'verify output urls', taskId });
    }
    urlChecks = await verifyOutputUrls(outputUrls, {
      fetchImpl,
      baseUrl: config.baseUrl,
      headers: cookieHeader(jar) ? { cookie: cookieHeader(jar) } : {},
    });

    await writeSmokeReport(config.reportPath, {
      startedAt,
      startedMs,
      config,
      taskId,
      task,
      metadata,
      outputUrls,
      urlChecks,
    });
    return { ok: true, taskId, task, metadata, outputUrls, urlChecks };
  } catch (error) {
    if (error instanceof SmokeTestError) {
      error.taskId = error.taskId || taskId;
      await writeSmokeReport(config.reportPath, {
        startedAt,
        startedMs,
        config,
        taskId,
        task,
        metadata,
        outputUrls,
        urlChecks,
        error,
      });
      throw error;
    }
    const smokeError = new SmokeTestError(error.message, { step: 'unexpected', taskId });
    await writeSmokeReport(config.reportPath, {
      startedAt,
      startedMs,
      config,
      taskId,
      task,
      metadata,
      outputUrls,
      urlChecks,
      error: smokeError,
    });
    throw smokeError;
  }
}

export async function writeSmokeReport(reportPath, data) {
  if (!reportPath) return null;
  const finishedAt = new Date();
  const suggestions = data.error?.suggestions || [];
  const report = redactReportValue({
    started_at: data.startedAt.toISOString(),
    finished_at: finishedAt.toISOString(),
    duration_ms: Date.now() - data.startedMs,
    base_url: data.config.baseUrl,
    provider: data.metadata?.provider || '',
    storage_disk: data.metadata?.storage_disk || '',
    task_id: data.taskId || null,
    status: data.task?.status || '',
    output_count: data.outputUrls?.length || 0,
    output_urls_reachable_count: data.urlChecks?.filter((item) => item.ok).length || 0,
    latency_ms: data.metadata?.latency_ms ?? null,
    cost: data.metadata?.cost ?? null,
    fallback_used: Boolean(data.metadata?.fallback_used),
    fallback_reason: data.metadata?.fallback_reason || '',
    image_mode: data.metadata?.image_mode || '',
    used_reference_image: Boolean(data.metadata?.used_reference_image),
    failed_step: data.error?.step || null,
    error_summary: data.error ? `${data.error.message}${data.error.bodySummary ? ` ${data.error.bodySummary}` : ''}`.slice(0, 1000) : '',
    suggestions,
  });
  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

export function parseTaskMetadata(log = null) {
  if (!log) return {};
  let raw = {};
  try {
    raw = typeof log.raw_response_json === 'string' ? JSON.parse(log.raw_response_json) : log.raw_response_json || {};
  } catch {
    raw = {};
  }
  return {
    provider: log.provider || raw.provider || '',
    model: log.model || raw.model || '',
    image_count: Number(log.image_count ?? raw.image_count ?? 0),
    cost: log.cost_usd ?? raw.cost ?? raw.estimated_cost ?? null,
    latency_ms: raw.latency_ms ?? null,
    fallback_used: Boolean(raw.fallback_used),
    fallback_reason: raw.fallback_reason || '',
    image_mode: raw.image_mode || '',
    used_reference_image: Boolean(raw.used_reference_image),
    storage_disk: raw.storage_disk || '',
    error_code: raw.error_code || '',
    error_message: raw.error_message || raw.error || '',
  };
}

export function formatSmokeError(error) {
  const lines = [
    `[smoke] failed step: ${error.step || 'unknown'}`,
    `[smoke] message: ${error.message}`,
  ];
  if (error.status) lines.push(`[smoke] HTTP status: ${error.status}`);
  if (error.bodySummary) lines.push(`[smoke] response: ${error.bodySummary}`);
  if (error.taskId) lines.push(`[smoke] task id: ${error.taskId}`);
  if (error.suggestions?.length) {
    lines.push('[smoke] suggested checks:');
    error.suggestions.forEach((item) => lines.push(`- ${item}`));
  }
  return lines.join('\n');
}

function cookieHeader(jar) {
  return [...jar.entries()].map(([key, value]) => `${key}=${value}`).join('; ');
}

function storeCookies(response, jar) {
  const setCookie =
    typeof response.headers.getSetCookie === 'function'
      ? response.headers.getSetCookie()
      : response.headers.get('set-cookie')
        ? [response.headers.get('set-cookie')]
        : [];
  for (const cookie of setCookie) {
    const [pair] = cookie.split(';');
    const [key, ...value] = pair.split('=');
    if (key && value.length) jar.set(key.trim(), value.join('=').trim());
  }
}

function parseMaybeJson(text) {
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return text;
  }
}

function summarizeBody(body) {
  if (typeof body === 'string') return body.slice(0, 700);
  return JSON.stringify(body || {}).slice(0, 700);
}

async function safeResponseSummary(response) {
  try {
    return (await response.text()).slice(0, 700);
  } catch {
    return '';
  }
}

function suggestionsForStep(step) {
  if (step.includes('storage') || step.includes('output')) {
    return ['Run npm run storage:check.', 'Check STORAGE_PUBLIC_URL, bucket CORS, and object permissions.'];
  }
  if (step.includes('provider') || step.includes('analyze') || step.includes('task')) {
    return ['Check AI_PROVIDER and OPENAI_API_KEY.', 'Inspect task ai_cost_logs and provider latency.', 'If using worker mode, confirm npm run worker is running.'];
  }
  return ['Check APP_URL/SMOKE_BASE_URL.', 'Check session/cookie settings and server logs.'];
}

function redactReportValue(value) {
  if (typeof value === 'string') {
    return value
      .replace(/sk-[A-Za-z0-9_-]{8,}/g, '[redacted_api_key]')
      .replace(/[A-Za-z0-9+/=]{240,}/g, '[redacted_base64]');
  }
  if (Array.isArray(value)) return value.map((item) => redactReportValue(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactReportValue(item)]));
  }
  return value;
}
