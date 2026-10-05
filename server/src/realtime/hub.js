// Fan-out of match updates to Socket.IO rooms. Publishing never throws: a realtime failure
// must never affect scoring (spec §55).
//
// Rooms:  match:<id>   authenticated scorer/admin consoles — every event, scorer view
//         led:<id>     LED displays — every event, live view
//         viewers:<id> public viewers — significant events only, live view
//         tournament   public — match status changes, points/stats updates

import { SOCKET_EVENTS, SOCKET_MESSAGE } from '@cricket/shared';
import { liveView, scorerView } from '../services/runtime.js';
import { metrics } from '../utils/metrics.js';
import { logger } from '../utils/logger.js';

let io = null;

export function attachIo(server) { io = server; }
export function getIo() { return io; }

export const rooms = {
  admin: (id) => `match:${id}`,
  led: (id) => `led:${id}`,
  viewer: (id) => `viewers:${id}`,
  tournament: 'tournament',
};

// Effects that viewers care about. Plain runs/dots go to the LED and scorers only.
const VIEWER_EFFECTS = new Set(['WICKET', 'OVER_COMPLETED', 'INNINGS_COMPLETED', 'MATCH_COMPLETED', 'MATCH_STARTED', 'INNINGS_STARTED', 'UNDO']);

export function envelopeType(effects) {
  if (effects.includes('MATCH_COMPLETED')) return SOCKET_EVENTS.MATCH_COMPLETED;
  if (effects.includes('INNINGS_COMPLETED')) return SOCKET_EVENTS.INNINGS_COMPLETED;
  if (effects.includes('WICKET')) return SOCKET_EVENTS.WICKET;
  if (effects.includes('OVER_COMPLETED')) return SOCKET_EVENTS.OVER_COMPLETED;
  if (effects.includes('MATCH_STARTED')) return SOCKET_EVENTS.MATCH_STARTED;
  if (effects.includes('UNDO')) return SOCKET_EVENTS.EVENT_UNDONE;
  if (effects.includes('BALL')) return SOCKET_EVENTS.BALL_RECORDED;
  return SOCKET_EVENTS.MATCH_STATE_UPDATED;
}

export const isViewerWorthy = (effects) => effects.some((e) => VIEWER_EFFECTS.has(e));

export function makeEnvelope(rt, type, effects, live) {
  return {
    type,
    matchId: rt.id,
    version: rt.lastSeq,
    eventId: `${rt.id}:${rt.lastSeq}`,
    ts: Date.now(),
    effects,
    live,
  };
}

function emit(room, envelope) {
  io.to(room).emit(SOCKET_MESSAGE, envelope);
  metrics.state.sockets.emitted++;
}

/** Called after a scoring command has been committed. */
export function publishMatchUpdate(rt, { effects, prevStatus }) {
  if (!io) return;
  try {
    const type = envelopeType(effects);
    const live = liveView(rt);
    emit(rooms.admin(rt.id), makeEnvelope(rt, type, effects, scorerView(rt)));
    const env = makeEnvelope(rt, type, effects, live);
    emit(rooms.led(rt.id), env);
    if (isViewerWorthy(effects)) emit(rooms.viewer(rt.id), env);
    // The match rooms already have this version; only the tournament room needs telling.
    if (prevStatus !== rt.match.status) emitStatusToTournament(rt, live);
  } catch (err) {
    logger.error({ err, matchId: rt.id }, 'realtime publish failed');
  }
}

function emitStatusToTournament(rt, live) {
  emit(rooms.tournament, {
    type: SOCKET_EVENTS.MATCH_STATUS_CHANGED, matchId: rt.id, version: rt.lastSeq, ts: Date.now(),
    status: rt.match.status, summary: rt.match.summary, result: live.result,
  });
}

/** Non-scoring changes (setup, confirmation, abandonment): tell everyone watching. */
export function publishStatusChange(rt) {
  if (!io) return;
  try {
    const live = liveView(rt);
    emitStatusToTournament(rt, live);
    const env = makeEnvelope(rt, SOCKET_EVENTS.MATCH_STATE_UPDATED, [], live);
    emit(rooms.led(rt.id), env);
    emit(rooms.viewer(rt.id), env);
    emit(rooms.admin(rt.id), makeEnvelope(rt, SOCKET_EVENTS.MATCH_STATE_UPDATED, [], scorerView(rt)));
  } catch (err) {
    logger.error({ err, matchId: rt.id }, 'realtime status publish failed');
  }
}

export function publishTournament(type, data = {}) {
  if (!io) return;
  try {
    emit(rooms.tournament, { type, ts: Date.now(), ...data });
  } catch (err) {
    logger.error({ err, type }, 'realtime tournament publish failed');
  }
}
