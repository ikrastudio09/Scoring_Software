// Fan-out of match updates to Socket.IO rooms. Publishing never throws: a realtime failure
// must never affect scoring (spec §55).
//
// Rooms:  match:<id>   authenticated scorer/admin consoles — every event, scorer view
//         led:<id>     LED displays — every event, live view
//         viewers:<id> public viewers — every event, live view (every ball is a product feature)
//         tournament   public — match status changes, points/stats updates
//
// One envelope is built per event and emitted once to the LED and viewer rooms together, so the
// cost per ball does not depend on how many viewers are connected (no per-viewer queries).

import { SOCKET_EVENTS, SOCKET_MESSAGE } from '@cricket/shared';
import { commentaryEntry, liveView, scorerView } from '../services/runtime.js';
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

export function makeEnvelope(rt, type, effects, live, ball) {
  const env = {
    type,
    matchId: rt.id,
    version: rt.lastSeq,
    eventId: `${rt.id}:${rt.lastSeq}`,
    ts: Date.now(),
    effects,
    live,
  };
  if (ball) env.ball = ball;
  return env;
}

/** Compact description of the delivery just recorded (commentary included). */
export function ballSummary(rt) {
  const e = commentaryEntry(rt, rt.lastSeq);
  if (!e) return null;
  const ball = { seq: e.seq, innings: e.innings, over: e.over, kind: e.kind, label: e.label, runs: e.runs, score: e.score, text: e.text, scoreText: e.scoreText };
  if (e.milestones.length) ball.milestones = e.milestones;
  if (e.endOfOver) ball.endOfOver = e.endOfOver;
  return ball;
}

function emit(room, envelope) {
  const target = Array.isArray(room) ? room.reduce((op, r) => op.to(r), io) : io.to(room);
  target.emit(SOCKET_MESSAGE, envelope);
  metrics.state.sockets.emitted++;
}

const publicRooms = (id) => [rooms.led(id), rooms.viewer(id)];

/** Called after a scoring command has been committed. */
export function publishMatchUpdate(rt, { effects, prevStatus }) {
  if (!io) return;
  try {
    const type = envelopeType(effects);
    const live = liveView(rt);
    let ball = null;
    try {
      ball = effects.includes('BALL') ? ballSummary(rt) : null;
    } catch (err) {
      // Commentary is downstream of scoring: a failure only drops the text, never the update.
      logger.error({ err, matchId: rt.id }, 'commentary generation failed');
    }
    emit(rooms.admin(rt.id), makeEnvelope(rt, type, effects, scorerView(rt), ball));
    emit(publicRooms(rt.id), makeEnvelope(rt, type, effects, live, ball));
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
    emit(publicRooms(rt.id), makeEnvelope(rt, SOCKET_EVENTS.MATCH_STATE_UPDATED, [], live));
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

/** A scorer edited one ball's commentary. Not a scoring change: no new version. */
export function publishCommentary(rt, entry) {
  if (!io) return;
  try {
    const env = { type: SOCKET_EVENTS.COMMENTARY_UPDATED, matchId: rt.id, version: rt.lastSeq, ts: Date.now(), entry };
    emit([rooms.admin(rt.id), rooms.viewer(rt.id)], env);
  } catch (err) {
    logger.error({ err, matchId: rt.id }, 'commentary publish failed');
  }
}
