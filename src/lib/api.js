let csrfToken = null;

export function setCsrfToken(token) {
  csrfToken = token;
}

export async function api(path, options = {}) {
  return request(path, options, true);
}

async function request(path, options = {}, allowCsrfRetry = false) {
  const headers = { ...(options.headers || {}) };
  if (!(options.body instanceof FormData)) {
    headers['Content-Type'] = headers['Content-Type'] || 'application/json';
  }
  const method = (options.method || 'GET').toUpperCase();
  if (csrfToken && !['GET', 'HEAD'].includes(method)) {
    headers['x-csrf-token'] = csrfToken;
  }

  const response = await fetch(path, {
    credentials: 'include',
    ...options,
    headers,
    body:
      options.body && !(options.body instanceof FormData) && typeof options.body !== 'string'
        ? JSON.stringify(options.body)
        : options.body,
  });

  const data = await response.json().catch(() => ({}));
  if (response.status === 419 && allowCsrfRetry && path !== '/api/session') {
    const session = await request('/api/session', {}, false);
    setCsrfToken(session.csrfToken);
    return request(path, options, false);
  }
  if (!response.ok) {
    const error = new Error(data.message || 'Request failed');
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data;
}

export async function loadSession() {
  const data = await request('/api/session');
  setCsrfToken(data.csrfToken);
  return data;
}
