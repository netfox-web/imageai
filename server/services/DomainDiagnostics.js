import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config/index.js';

const sensitiveKeyPattern = /password|api[_-]?key|token/i;
const baseSuggestions = [
  'Check DNS A record @ -> 211.75.219.184.',
  'Check DNS propagation.',
  'Check NAS reverse proxy source host imageai.tw.',
  'Check NAS reverse proxy source port 443.',
  'Check destination http://127.0.0.1:3050.',
  "Check Let's Encrypt certificate.",
  'Check router/firewall ports 80/443 open.',
  'Check if ISP blocks inbound 80/443.',
  'Check if imageai.tw redirects to wrong host.',
  'Check NAS Web Station / reverse proxy conflict.',
];

const imageAiRootCauses = [
  'Missing apex A record for imageai.tw',
  'Certificate does not include imageai.tw',
  'Reverse proxy host imageai.tw is not matching app destination',
];

const imageAiManualSteps = [
  'Add A record @ -> 211.75.219.184 with DNS only',
  'Create Synology reverse proxy imageai.tw:443 -> http://127.0.0.1:3050',
  "Issue and assign Let's Encrypt certificate for imageai.tw and www.imageai.tw",
];

const imageAiCommands = [
  'nslookup imageai.tw',
  'Test-NetConnection imageai.tw -Port 443',
  'curl.exe -I https://imageai.tw/health',
];

function isSensitiveKey(key = '') {
  const normalized = String(key).toLowerCase();
  return normalized === 'authorization'
    || normalized === 'cookie'
    || normalized === 'set-cookie'
    || normalized === 'session'
    || normalized === 'secret'
    || normalized.endsWith('_secret')
    || normalized.endsWith('_session')
    || sensitiveKeyPattern.test(normalized);
}

function classifyFailure({ error, response, baseUrl } = {}) {
  const status = response?.status || null;
  const location = response?.headers?.get?.('location') || '';
  const causeCode = error?.cause?.code || error?.code || '';
  const message = String(error?.message || response?.statusText || 'Request failed.');
  const lower = `${causeCode} ${message}`.toLowerCase();
  let errorCode = 'request_failed';
  let summary = message;

  if (status >= 300 && status < 400) {
    errorCode = location && location.replace(/\/+$/, '') === String(baseUrl || '').replace(/\/+$/, '')
      ? 'redirect_loop'
      : 'http_redirect_not_followed';
    summary = `HTTP ${status} redirect${location ? ` to ${location}` : ''}.`;
  } else if (status === 502 || status === 503 || status === 504) {
    errorCode = 'reverse_proxy_unreachable';
    summary = `HTTP ${status}; reverse proxy or upstream app may be unreachable.`;
  } else if (status) {
    errorCode = 'http_status_not_ok';
    summary = `HTTP ${status} returned by target.`;
  } else if (error?.name === 'AbortError' || lower.includes('timeout') || lower.includes('timedout') || lower.includes('etimedout')) {
    errorCode = 'connection_timeout';
    summary = 'Connection timed out.';
  } else if (lower.includes('enotfound') || lower.includes('eai_again') || lower.includes('dns')) {
    errorCode = 'dns_resolve_failed';
    summary = 'DNS resolution failed.';
  } else if (lower.includes('econnrefused') || lower.includes('connect refused')) {
    errorCode = 'tcp_connect_failed';
    summary = 'TCP connection was refused.';
  } else if (lower.includes('cert') || lower.includes('tls') || lower.includes('ssl') || lower.includes('unable_to_verify') || lower.includes('wrong_principal') || lower.includes('self_signed')) {
    errorCode = 'tls_certificate_failed';
    summary = 'TLS certificate validation failed.';
  } else if (lower.includes('fetch failed')) {
    errorCode = 'reverse_proxy_unreachable';
    summary = 'Fetch failed before receiving HTTP response; DNS, TCP, TLS, firewall, or reverse proxy may be blocking the request.';
  }

  return {
    error_code: errorCode,
    error_summary: summary.slice(0, 500),
    error_cause_code: causeCode || null,
    suggestions: baseSuggestions,
  };
}

export function buildDomainActionOutput({ ok, base_url: baseUrl, error_code: errorCode, failed_step: failedStep } = {}) {
  const host = (() => {
    try {
      return new URL(baseUrl || '').hostname.toLowerCase();
    } catch {
      return '';
    }
  })();
  const isImageAi = host === 'imageai.tw' || host === 'www.imageai.tw';
  if (ok) {
    return {
      quick_summary: `Domain check passed for ${baseUrl || 'configured base URL'}.`,
      likely_root_cause: [],
      next_manual_steps: [],
      commands_to_run: [
        `curl.exe -I ${(baseUrl || 'https://imageai.tw').replace(/\/+$/, '')}/health`,
      ],
    };
  }

  if (isImageAi) {
    return {
      quick_summary: 'App is healthy on IP:3050, but public domain does not resolve and Synology HTTPS vhost/certificate is not configured correctly.',
      likely_root_cause: imageAiRootCauses,
      next_manual_steps: imageAiManualSteps,
      commands_to_run: imageAiCommands,
    };
  }

  const likelyRootCause = [];
  if (errorCode === 'dns_resolve_failed' || errorCode === 'connection_timeout') {
    likelyRootCause.push('Public DNS or inbound TCP connectivity is not ready');
  }
  if (errorCode === 'tls_certificate_failed') {
    likelyRootCause.push('TLS certificate does not match the requested hostname');
  }
  if (errorCode === 'reverse_proxy_unreachable' || errorCode === 'http_status_not_ok' || failedStep === 'admin_page') {
    likelyRootCause.push('Reverse proxy destination or virtual host is not routing to the app');
  }
  return {
    quick_summary: 'Public domain check failed before the app acceptance flow could complete.',
    likely_root_cause: likelyRootCause.length ? likelyRootCause : ['DNS, TLS, firewall, or reverse proxy requires manual review'],
    next_manual_steps: [
      'Confirm DNS points to the NAS public IP',
      'Confirm router/firewall forwards TCP 80 and 443 to the NAS',
      'Confirm reverse proxy routes HTTPS hostname traffic to the local app port',
      'Confirm the certificate includes the public hostname',
    ],
    commands_to_run: [
      `nslookup ${host || '<domain>'}`,
      `Test-NetConnection ${host || '<domain>'} -Port 443`,
      `curl.exe -I ${(baseUrl || 'https://<domain>').replace(/\/+$/, '')}/health`,
    ],
  };
}

function timeoutSignal(timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  return { controller, timeout };
}

function safeHeaders(headers) {
  const safe = {};
  headers.forEach((value, key) => {
    safe[key] = isSensitiveKey(key) ? '[redacted]' : String(value).slice(0, 500);
  });
  return safe;
}

function mergeCookies(current = '', response) {
  const raw = response.headers.get('set-cookie');
  if (!raw) return current;
  const existing = current ? current.split('; ').filter(Boolean) : [];
  const byName = new Map(existing.map((cookie) => [cookie.split('=')[0], cookie]));
  raw.split(/,(?=[^;,]+=)/).forEach((cookie) => {
    const first = cookie.split(';')[0].trim();
    if (first) byName.set(first.split('=')[0], first);
  });
  return [...byName.values()].join('; ');
}

async function requestJson(baseUrl, pathName, options = {}) {
  const { controller, timeout } = timeoutSignal(options.timeoutMs || config.domainCheckTimeoutMs);
  const startedAt = Date.now();
  try {
    const response = await (options.fetchImpl || fetch)(`${baseUrl}${pathName}`, {
      method: options.method || 'GET',
      signal: controller.signal,
      headers: {
        ...(options.cookie ? { cookie: options.cookie } : {}),
        ...(options.csrfToken ? { 'x-csrf-token': options.csrfToken } : {}),
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      redirect: 'manual',
    });
    const text = await response.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text ? text.slice(0, 500) : null;
    }
    return {
      ok: response.ok,
      status: response.status,
      latency_ms: Date.now() - startedAt,
      headers: safeHeaders(response.headers),
      body,
      cookie: mergeCookies(options.cookie, response),
      ...(!response.ok ? classifyFailure({ response, baseUrl, pathName }) : {}),
    };
  } catch (error) {
    const classified = classifyFailure({ error, baseUrl });
    return {
      ok: false,
      status: null,
      latency_ms: Date.now() - startedAt,
      error_code: classified.error_code,
      error_summary: classified.error_summary,
      error_cause_code: classified.error_cause_code,
      error_message: String(error.message || 'Request failed.').slice(0, 300),
      suggestions: classified.suggestions,
      retryable: error.name === 'AbortError' || error instanceof TypeError,
      headers: {},
      body: null,
      cookie: options.cookie || '',
    };
  } finally {
    clearTimeout(timeout);
  }
}

function redact(value, secrets = []) {
  const text = JSON.stringify(value, (key, item) => {
    if (isSensitiveKey(key)) return '[redacted]';
    if (typeof item === 'string' && item.length > 1200) return `${item.slice(0, 1200)}...[truncated]`;
    return item;
  });
  let output = text;
  secrets.filter(Boolean).forEach((secret) => {
    output = output.split(secret).join('[redacted]');
  });
  return JSON.parse(output);
}

export async function runDomainCheck(env = process.env, options = {}) {
  const baseUrl = String(env.DOMAIN_CHECK_BASE_URL || config.domainCheckBaseUrl || '').replace(/\/+$/, '');
  const adminUser = env.DOMAIN_CHECK_ADMIN_USER || config.domainCheckAdminUser || '';
  const adminPassword = env.DOMAIN_CHECK_ADMIN_PASSWORD || config.domainCheckAdminPassword || '';
  const timeoutMs = Number(env.DOMAIN_CHECK_TIMEOUT_MS || config.domainCheckTimeoutMs || 15000);
  const fetchImpl = options.fetchImpl || fetch;
  const started = new Date();
  const steps = [];
  const add = (name, result) => steps.push({ name, ...redact(result, [adminPassword]) });

  const health = await requestJson(baseUrl, '/health', { fetchImpl, timeoutMs });
  add('health', health);
  const deep = await requestJson(baseUrl, '/health/deep', { fetchImpl, timeoutMs });
  add('health_deep', deep);
  const root = await requestJson(baseUrl, '/', { fetchImpl, timeoutMs });
  add('root', { ok: root.ok, status: root.status, latency_ms: root.latency_ms, headers: root.headers });
  const adminPage = await requestJson(baseUrl, '/admin', { fetchImpl, timeoutMs });
  add('admin_page', { ok: adminPage.ok, status: adminPage.status, latency_ms: adminPage.latency_ms, headers: adminPage.headers });

  let login = { ok: false, status: null, skipped: true, reason: 'DOMAIN_CHECK_ADMIN_PASSWORD is not set.' };
  if (adminPassword) {
    const session = await requestJson(baseUrl, '/api/session', { fetchImpl, timeoutMs });
    const csrfToken = session.body?.csrfToken;
    login = await requestJson(baseUrl, '/api/auth/login', {
      fetchImpl,
      timeoutMs,
      method: 'POST',
      cookie: session.cookie,
      csrfToken,
      body: { email: adminUser, password: adminPassword },
    });
  }
  add('admin_login', {
    ok: login.ok,
    status: login.status,
    latency_ms: login.latency_ms,
    skipped: login.skipped || false,
    reason: login.reason || null,
    user: login.body?.user ? { email: login.body.user.email, role: login.body.user.role } : null,
  });

  let httpRedirect = { skipped: true, reason: 'Base URL is not HTTPS.' };
  try {
    const parsed = new URL(baseUrl);
    if (parsed.protocol === 'https:') {
      const httpBase = `http://${parsed.host}`;
      httpRedirect = await requestJson(httpBase, '/', { fetchImpl, timeoutMs: Math.min(timeoutMs, 5000) });
      httpRedirect.expected_https = true;
      httpRedirect.location = httpRedirect.headers?.location || null;
      httpRedirect.redirects_to_https = Boolean(httpRedirect.location?.startsWith('https://'));
    }
  } catch {
    httpRedirect = { ok: false, status: null, error_code: 'invalid_base_url', error_summary: 'DOMAIN_CHECK_BASE_URL is not a valid URL.' };
  }
  add('http_redirect', {
    ok: Boolean(httpRedirect.redirects_to_https),
    status: httpRedirect.status,
    skipped: httpRedirect.skipped || false,
    reason: httpRedirect.reason || null,
    location: httpRedirect.location || null,
    redirects_to_https: httpRedirect.redirects_to_https || false,
    error_code: httpRedirect.error_code || null,
    error_summary: httpRedirect.error_summary || null,
    latency_ms: httpRedirect.latency_ms ?? null,
  });

  const httpsEnabled = baseUrl.startsWith('https://');
  const cookieHeaders = [root.headers?.['set-cookie'], adminPage.headers?.['set-cookie']].filter(Boolean).join('; ');
  const summary = {
    started_at: started.toISOString(),
    finished_at: new Date().toISOString(),
    duration_ms: Date.now() - started.getTime(),
    base_url: baseUrl,
    https_enabled: httpsEnabled,
    health_ok: Boolean(health.ok),
    deep_ok: Boolean(deep.ok),
    root_ok: Boolean(root.ok),
    admin_page_ok: Boolean(adminPage.ok),
    admin_login_ok: Boolean(login.ok),
    http_redirect_ok: Boolean(httpRedirect.redirects_to_https),
    cookie_secure_observed: /secure/i.test(cookieHeaders),
    same_site_observed: /samesite/i.test(cookieHeaders),
    cors_origin: root.headers?.['access-control-allow-origin'] || null,
    app_url: deep.body?.appUrl || null,
    worker_status: deep.body?.checks?.queue?.driver || null,
    secrets_redacted: true,
  };
  const firstFailure = steps.find((step) => !step.ok && !step.skipped) || null;
  const ok = steps.every((step) => step.ok || step.skipped);
  const actionOutput = buildDomainActionOutput({
    ok,
    base_url: baseUrl,
    failed_step: firstFailure?.name || null,
    error_code: firstFailure?.error_code || null,
  });
  const report = redact({
    ok,
    base_url: baseUrl,
    failed_step: firstFailure?.name || null,
    error_code: firstFailure?.error_code || null,
    error_summary: firstFailure?.error_summary || firstFailure?.error_message || null,
    quick_summary: actionOutput.quick_summary,
    likely_root_cause: actionOutput.likely_root_cause,
    next_manual_steps: actionOutput.next_manual_steps,
    commands_to_run: actionOutput.commands_to_run,
    suggestions: firstFailure ? [...new Set([...(firstFailure.suggestions || []), ...baseSuggestions])] : [],
    summary,
    steps,
  }, [adminPassword]);
  const reportPath = env.DOMAIN_CHECK_REPORT_PATH || config.domainCheckReportPath;
  if (reportPath) {
    const absolute = path.resolve(config.rootDir, reportPath);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, JSON.stringify(report, null, 2));
    report.report_path = reportPath;
  }
  return report;
}

export function formatDomainCheck(report) {
  const lines = [
    `[domain] base_url=${report.summary.base_url}`,
    `[domain] https=${report.summary.https_enabled ? 'yes' : 'no'} health=${report.summary.health_ok ? 'ok' : 'fail'} deep=${report.summary.deep_ok ? 'ok' : 'fail'} admin=${report.summary.admin_page_ok ? 'ok' : 'fail'} login=${report.summary.admin_login_ok ? 'ok' : report.steps.find((s) => s.name === 'admin_login')?.skipped ? 'skipped' : 'fail'}`,
  ];
  report.steps.forEach((step) => {
    lines.push(`[${step.ok || step.skipped ? 'PASS' : 'FAIL'}] ${step.name}: status=${step.status ?? '-'} latency=${step.latency_ms ?? '-'}ms${step.error_code ? ` code=${step.error_code}` : ''}${step.reason ? ` reason=${step.reason}` : ''}`);
  });
  if (!report.ok) {
    lines.push(`[domain] failed_step=${report.failed_step || '-'} code=${report.error_code || '-'} summary=${report.error_summary || '-'}`);
    lines.push(`[domain] quick_summary=${report.quick_summary || '-'}`);
    if (report.likely_root_cause?.length) {
      lines.push('[domain] likely_root_cause:');
      report.likely_root_cause.forEach((item) => lines.push(`- ${item}`));
    }
    if (report.next_manual_steps?.length) {
      lines.push('[domain] next_manual_steps:');
      report.next_manual_steps.forEach((item) => lines.push(`- ${item}`));
    }
    if (report.commands_to_run?.length) {
      lines.push('[domain] commands_to_run:');
      report.commands_to_run.forEach((item) => lines.push(`- ${item}`));
    }
    (report.suggestions || []).forEach((suggestion) => lines.push(`[suggestion] ${suggestion}`));
  }
  if (report.report_path) lines.push(`[domain] report=${report.report_path}`);
  return lines.join('\n');
}

export function readLastDomainCheck(reportPath = config.domainCheckReportPath) {
  try {
    const absolute = path.resolve(config.rootDir, reportPath);
    return JSON.parse(fs.readFileSync(absolute, 'utf8'));
  } catch {
    return null;
  }
}
