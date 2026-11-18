import { createApi, createLiveConnection } from '@cricket/client';

// Empty in the browser (same origin). The Android build sets VITE_API_URL to the public server.
export const API_URL = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');

// An app page on https:// can never reach an http:// API: browsers and Android's WebView block it
// as mixed content (REST and sockets alike). Say so plainly instead of "Reconnecting…" forever.
if (typeof window !== 'undefined' && window.location.protocol === 'https:' && API_URL.startsWith('http:')) {
  console.error(`[viewer] Mixed content: this app is served over https but VITE_API_URL is ${API_URL}. `
    + 'Every request will be blocked. Rebuild the Android app with `npm run cap:sync -w apps/viewer` '
    + '(it serves local-network builds from http://localhost), or use an https:// API.');
}

export const api = createApi({ baseUrl: API_URL });
export const live = createLiveConnection({ url: API_URL || undefined, client: 'viewer' });
