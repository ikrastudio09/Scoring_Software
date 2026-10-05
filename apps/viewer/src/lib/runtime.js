import { createApi, createLiveConnection } from '@cricket/client';

// Empty in the browser (same origin). The Android build sets VITE_API_URL to the public server.
export const API_URL = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');

export const api = createApi({ baseUrl: API_URL });
export const live = createLiveConnection({ url: API_URL || undefined, client: 'viewer' });
