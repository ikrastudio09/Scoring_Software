// Minimal fetch wrapper. Every server error has the shape { error: { code, message, details } }.

export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }

  get isNetwork() { return this.status === 0; }
}

/**
 * createApi({ baseUrl, getToken, onUnauthorized })
 * baseUrl: '' for same-origin, or 'https://scores.example.com' for the Android app.
 */
export function createApi({ baseUrl = '', getToken = () => null, onUnauthorized = () => {} } = {}) {
  async function request(method, path, body, { timeoutMs = 10000, signal } = {}) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(new DOMException('timeout', 'TimeoutError')), timeoutMs);
    if (signal) signal.addEventListener('abort', () => ctrl.abort(signal.reason), { once: true });
    const headers = { Accept: 'application/json' };
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    let res;
    try {
      res = await fetch(`${baseUrl}/api${path}`, {
        method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: ctrl.signal, cache: 'no-store',
      });
    } catch (err) {
      const timeout = err?.name === 'TimeoutError' || ctrl.signal.reason?.name === 'TimeoutError';
      throw new ApiError(0, timeout ? 'TIMEOUT' : 'NETWORK', timeout ? 'The server did not respond in time' : 'Network error — check the connection');
    } finally {
      clearTimeout(timer);
    }
    if (res.status === 204) return null;
    let data = null;
    try { data = await res.json(); } catch { /* non-JSON */ }
    if (!res.ok) {
      if (res.status === 401) onUnauthorized();
      const e = data?.error || {};
      throw new ApiError(res.status, e.code || 'HTTP_ERROR', e.message || `Request failed (${res.status})`, e.details);
    }
    return data;
  }
  return {
    get: (p, o) => request('GET', p, undefined, o),
    post: (p, b = {}, o) => request('POST', p, b, o),
    put: (p, b = {}, o) => request('PUT', p, b, o),
    del: (p, o) => request('DELETE', p, undefined, o),
  };
}

/** Random idempotency key for a scoring command. */
export function newEventId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}
