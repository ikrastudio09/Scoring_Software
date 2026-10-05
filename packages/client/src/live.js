// Realtime connection shared by all clients.
//
// One Socket.IO connection per app. Subscriptions are remembered and re-sent on every
// (re)connect; the server answers each subscribe with a fresh snapshot, so recovery after a
// network drop is a single message. A version guard ensures an older message can never
// overwrite newer state.

import { io } from 'socket.io-client';
import { SOCKET_EVENTS, SOCKET_MESSAGE, SOCKET_SUBSCRIBE, SOCKET_UNSUBSCRIBE } from '@cricket/shared';

/**
 * Should `incoming` replace the state we have at version `current`?
 * Newer versions always win; an equal-version snapshot (MATCH_STATE_UPDATED) replaces in place,
 * since non-scoring changes such as result confirmation are re-broadcast at the same version.
 */
export function isNewer(incoming, current) {
  if (current === null || current === undefined) return true;
  if (incoming.version > current) return true;
  return incoming.version === current && incoming.type === SOCKET_EVENTS.MATCH_STATE_UPDATED;
}

export function createLiveConnection({ url = undefined, client = 'viewer', getToken = () => null } = {}) {
  const socket = io(url, {
    autoConnect: false,
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionDelay: 500,
    reconnectionDelayMax: 5000,
    randomizationFactor: 0.5,
    timeout: 10000,
    auth: (cb) => cb({ client, token: getToken() }),
  });

  const subs = new Map(); // key → { msg, handlers:Set }
  const statusListeners = new Set();
  const tournamentHandlers = new Set();
  let status = 'connecting';
  let lastMessageAt = null;

  const setStatus = (s) => {
    status = s;
    for (const l of statusListeners) l(s);
  };
  const keyOf = (matchId, channel) => `${channel}:${matchId}`;

  socket.on('connect', () => {
    setStatus('connected');
    for (const { msg } of subs.values()) socket.emit(SOCKET_SUBSCRIBE, msg);
    if (tournamentHandlers.size) socket.emit(SOCKET_SUBSCRIBE, { channel: 'tournament' });
  });
  socket.on('disconnect', () => setStatus('reconnecting'));
  socket.on('connect_error', () => setStatus(socket.active ? 'reconnecting' : 'offline'));
  socket.io.on('reconnect_attempt', () => setStatus('reconnecting'));

  socket.on(SOCKET_MESSAGE, (env) => {
    lastMessageAt = Date.now();
    if (env.matchId && env.live !== undefined) {
      for (const [key, sub] of subs) {
        if (key.endsWith(`:${env.matchId}`)) for (const h of sub.handlers) h(env);
      }
    }
    if (!env.live || env.type === SOCKET_EVENTS.MATCH_STATUS_CHANGED) {
      for (const h of tournamentHandlers) h(env);
    }
  });

  // Back from the background or from a network blip: the socket may have silently missed
  // messages while it "stayed connected", so resubscribe (→ fresh snapshot) or reconnect.
  const resync = () => {
    if (!socket.connected) { socket.connect(); return; }
    setStatus('connected');
    for (const { msg } of subs.values()) socket.emit(SOCKET_SUBSCRIBE, msg);
  };
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') resync(); });
  }
  if (typeof window !== 'undefined') {
    window.addEventListener('online', resync);
    window.addEventListener('offline', () => setStatus('offline'));
  }

  function ensureConnected() {
    if (!socket.connected && !socket.active) socket.connect();
  }

  return {
    socket,
    get status() { return status; },
    get lastMessageAt() { return lastMessageAt; },
    onStatus(fn) { statusListeners.add(fn); fn(status); return () => statusListeners.delete(fn); },

    /** Subscribe to a match; returns an unsubscribe function. */
    subscribe(matchId, channel, handler) {
      const key = keyOf(matchId, channel);
      let sub = subs.get(key);
      if (!sub) {
        sub = { msg: { matchId, channel }, handlers: new Set() };
        subs.set(key, sub);
        if (socket.connected) socket.emit(SOCKET_SUBSCRIBE, sub.msg);
      }
      sub.handlers.add(handler);
      ensureConnected();
      return () => {
        sub.handlers.delete(handler);
        if (!sub.handlers.size) {
          subs.delete(key);
          if (socket.connected) socket.emit(SOCKET_UNSUBSCRIBE, sub.msg);
        }
      };
    },

    onTournament(handler) {
      tournamentHandlers.add(handler);
      if (socket.connected && tournamentHandlers.size === 1) socket.emit(SOCKET_SUBSCRIBE, { channel: 'tournament' });
      ensureConnected();
      return () => tournamentHandlers.delete(handler);
    },

    reconnect() { socket.disconnect(); socket.connect(); },
  };
}
