import { createApi, createLiveConnection } from '@cricket/client';

const TOKEN_KEY = 'cricket.admin.token';

export const tokenStore = {
  get: () => { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } },
  set: (t) => { try { localStorage.setItem(TOKEN_KEY, t); } catch { /* storage unavailable */ } },
  clear: () => { try { localStorage.removeItem(TOKEN_KEY); } catch { /* storage unavailable */ } },
};

export const api = createApi({
  baseUrl: '',
  getToken: tokenStore.get,
  onUnauthorized: () => window.dispatchEvent(new Event('auth:expired')),
});

export const live = createLiveConnection({ client: 'admin', getToken: tokenStore.get });
