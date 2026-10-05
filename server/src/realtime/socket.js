// Socket.IO server. Read-only for clients: all writes go through the REST API.
//
// Client protocol:
//   emit  cricket:subscribe   { matchId, channel: 'led' | 'viewer' | 'admin' }  (ack: { ok, error? })
//   emit  cricket:subscribe   { channel: 'tournament' }
//   emit  cricket:unsubscribe { matchId, channel }
//   on    cricket:event       envelope { type, matchId, version, eventId, ts, effects, live }
// After every (re)subscribe the server immediately sends MATCH_STATE_UPDATED with the current
// snapshot, so a reconnecting client recovers with one message and never replays history.

import { Server } from 'socket.io';
import mongoose from 'mongoose';
import { CHANNELS, SOCKET_EVENTS, SOCKET_MESSAGE, SOCKET_SUBSCRIBE, SOCKET_UNSUBSCRIBE } from '@cricket/shared';
import { attachIo, makeEnvelope, rooms } from './hub.js';
import { getRuntime, liveView, scorerView } from '../services/runtime.js';
import { verifyToken } from '../services/auth.js';
import { metrics } from '../utils/metrics.js';
import { logger } from '../utils/logger.js';

const MAX_ROOMS_PER_SOCKET = 12;

export function createSocketServer(httpServer, { corsOrigin }) {
  const io = new Server(httpServer, {
    cors: { origin: corsOrigin, credentials: false },
    pingInterval: 20000,
    pingTimeout: 15000,
    maxHttpBufferSize: 10_000, // clients only send tiny subscribe messages
    // No connectionStateRecovery on purpose: missed packets are never replayed. Clients
    // resubscribe on every connect and receive one fresh snapshot instead.
  });

  io.use((socket, next) => {
    socket.data.user = verifyToken(socket.handshake.auth?.token);
    socket.data.channel = ['led', 'admin'].includes(socket.handshake.auth?.client) ? socket.handshake.auth.client : 'viewer';
    next();
  });

  io.on('connection', (socket) => {
    const ch = socket.data.channel;
    metrics.state.sockets.connected++;
    metrics.state.sockets.connects++;
    metrics.state.sockets.byChannel[ch] = (metrics.state.sockets.byChannel[ch] || 0) + 1;

    socket.on(SOCKET_SUBSCRIBE, async (msg, ack) => {
      const reply = typeof ack === 'function' ? ack : () => {};
      try {
        const channel = msg?.channel;
        if (channel === 'tournament') {
          socket.join(rooms.tournament);
          return reply({ ok: true });
        }
        const matchId = String(msg?.matchId || '');
        if (!mongoose.isValidObjectId(matchId)) return reply({ ok: false, error: 'Invalid match id' });
        if (!Object.values(CHANNELS).includes(channel)) return reply({ ok: false, error: 'Invalid channel' });
        if (channel === CHANNELS.ADMIN && !socket.data.user) return reply({ ok: false, error: 'Unauthorized' });
        if (socket.rooms.size > MAX_ROOMS_PER_SOCKET) return reply({ ok: false, error: 'Too many subscriptions' });

        const rt = await getRuntime(matchId);
        socket.join(rooms[channel](matchId));
        const view = channel === CHANNELS.ADMIN ? scorerView(rt) : liveView(rt);
        socket.emit(SOCKET_MESSAGE, makeEnvelope(rt, SOCKET_EVENTS.MATCH_STATE_UPDATED, [], view));
        return reply({ ok: true, version: rt.lastSeq });
      } catch (err) {
        logger.warn({ err: err.message, msg }, 'subscribe failed');
        return reply({ ok: false, error: err.status === 404 ? 'Match not found' : 'Subscribe failed' });
      }
    });

    socket.on(SOCKET_UNSUBSCRIBE, (msg) => {
      const matchId = String(msg?.matchId || '');
      if (msg?.channel === 'tournament') socket.leave(rooms.tournament);
      else if (rooms[msg?.channel]) socket.leave(rooms[msg.channel](matchId));
    });

    socket.on('disconnect', () => {
      metrics.state.sockets.connected--;
      metrics.state.sockets.disconnects++;
      metrics.state.sockets.byChannel[ch]--;
    });
  });

  attachIo(io);
  return io;
}
