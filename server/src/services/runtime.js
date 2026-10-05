// Match runtime: the in-memory, replayed state of a match, rebuilt from the event log.
//
// The cache is only an optimisation. Dropping it (or restarting the process) loses nothing:
// the next access replays the persisted events and arrives at exactly the same state.

import { EVENT_TYPES, ERROR_CODES } from '@cricket/shared';
import { Match, MatchEvent, Player, Team } from '../models/index.js';
import { replay, toLiveView, toScorerView, toScorecard } from '../engine/index.js';
import { KeyedMutex } from '../utils/async.js';
import { AppError, notFound } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

const cache = new Map();
const loading = new Map();
const mutex = new KeyedMutex();

/** Serialise every state-changing operation on one match. */
export const withMatchLock = (matchId, fn) => mutex.run(String(matchId), fn);

export function buildSetup(match) {
  const a = match.teamA && String(match.teamA);
  const b = match.teamB && String(match.teamB);
  const xiA = (match.playingXI?.teamA || []).map(String);
  const xiB = (match.playingXI?.teamB || []).map(String);
  if (!a || !b || !match.toss?.winner || !match.toss?.decision || xiA.length < 2 || xiB.length < 2) return null;
  const tossWinner = String(match.toss.winner);
  const tossLoser = tossWinner === a ? b : a;
  const battingFirst = match.toss.decision === 'bat' ? tossWinner : tossLoser;
  return {
    rules: { ...match.rules },
    battingFirst,
    bowlingFirst: battingFirst === a ? b : a,
    xi: { [a]: xiA, [b]: xiB },
  };
}

async function buildMeta(match) {
  const teamIds = [match.teamA, match.teamB].filter(Boolean);
  const playerIds = [...(match.playingXI?.teamA || []), ...(match.playingXI?.teamB || [])];
  const [teams, players] = await Promise.all([
    Team.find({ _id: { $in: teamIds } }, 'name shortName color logoUrl').lean(),
    Player.find({ _id: { $in: playerIds } }, 'name').lean(),
  ]);
  return {
    matchId: String(match._id),
    teams: Object.fromEntries(teams.map((t) => [String(t._id), { name: t.name, shortName: t.shortName, color: t.color, logoUrl: t.logoUrl }])),
    players: Object.fromEntries(players.map((p) => [String(p._id), { name: p.name }])),
  };
}

/** Effective events = the log with every UNDO applied. Verifies the log's integrity. */
export function resolveEffective(events) {
  const stack = [];
  for (const e of events) {
    if (e.type === EVENT_TYPES.UNDO) {
      const reverted = stack.pop();
      if (!reverted || reverted.seq !== e.undoesSeq) {
        throw new AppError(500, ERROR_CODES.INTERNAL, `Event log integrity error at seq ${e.seq}`);
      }
    } else {
      stack.push(e);
    }
  }
  return stack;
}

export function undoLastEvent(target, seq) {
  return {
    type: EVENT_TYPES.UNDO, seq, effects: ['UNDO'], label: target.label || null,
    undid: { type: target.type, seq: target.seq, label: target.label || null },
  };
}

async function load(matchId) {
  const match = await Match.findById(matchId).lean();
  if (!match) throw notFound('Match');
  const [meta, events] = await Promise.all([
    buildMeta(match),
    MatchEvent.find({ match: match._id }).sort({ seq: 1 }).lean(),
  ]);
  const setup = buildSetup(match);
  const effective = resolveEffective(events);
  const lastSeq = events.length ? events[events.length - 1].seq : 0;
  let state = null;
  if (setup) {
    state = replay(setup, effective);
    state.version = lastSeq;
    const last = events[events.length - 1];
    if (last?.type === EVENT_TYPES.UNDO) {
      const target = events.find((e) => e.seq === last.undoesSeq);
      state.lastEvent = undoLastEvent(target, last.seq);
    }
  } else if (events.length) {
    throw new AppError(500, ERROR_CODES.INTERNAL, 'Match has scoring events but no setup');
  }
  const rt = {
    id: String(match._id),
    match,
    setup,
    meta,
    state,
    effective,
    lastSeq,
    clientIds: new Set(events.filter((e) => e.clientEventId).map((e) => e.clientEventId)),
    views: {},
  };
  logger.debug({ matchId: rt.id, events: events.length, version: lastSeq }, 'match runtime loaded');
  return rt;
}

export async function getRuntime(matchId) {
  const key = String(matchId);
  const hit = cache.get(key);
  if (hit) return hit;
  // De-duplicate concurrent loads (e.g. many viewers opening the same match after a restart).
  if (!loading.has(key)) {
    loading.set(key, load(key).then((rt) => {
      cache.set(key, rt);
      return rt;
    }).finally(() => loading.delete(key)));
  }
  return loading.get(key);
}

export function invalidateRuntime(matchId) {
  if (matchId) cache.delete(String(matchId));
  else cache.clear();
}

export function cachedRuntimes() {
  return [...cache.values()];
}

function memo(rt, key, fn) {
  const v = rt.views[key];
  if (v && v.version === rt.lastSeq) return v.value;
  const value = fn();
  rt.views[key] = { version: rt.lastSeq, value };
  return value;
}

function decorate(rt, view) {
  const m = rt.match;
  return {
    ...view,
    version: rt.lastSeq,
    match: {
      number: m.number, status: m.status, stage: m.stage, venue: m.venue, scheduledAt: m.scheduledAt,
      teamA: m.teamA ? String(m.teamA) : null, teamB: m.teamB ? String(m.teamB) : null,
      toss: m.toss?.winner ? { winner: String(m.toss.winner), decision: m.toss.decision } : null,
      resultConfirmed: Boolean(m.result?.confirmed),
      playerOfMatch: m.result?.playerOfMatch ? String(m.result.playerOfMatch) : null,
    },
  };
}

const emptyView = (rt) => decorate(rt, {
  matchId: rt.id, state: 'NOT_READY', teams: rt.meta.teams, innings: [], current: null, lastEvent: null, result: null,
});

export function liveView(rt) {
  return memo(rt, 'live', () => (rt.state ? decorate(rt, toLiveView(rt.state, rt.setup, rt.meta)) : emptyView(rt)));
}

export function scorerView(rt) {
  return memo(rt, 'scorer', () => {
    if (!rt.state) return emptyView(rt);
    const last = rt.effective[rt.effective.length - 1];
    return {
      ...decorate(rt, toScorerView(rt.state, rt.setup, rt.meta)),
      // What an undo would revert right now.
      undo: last ? { seq: last.seq, type: last.type, label: last.label || null } : null,
    };
  });
}

export function scorecard(rt) {
  return memo(rt, 'scorecard', () => (rt.state
    ? decorate(rt, toScorecard(rt.state, rt.setup, rt.meta))
    : decorate(rt, { matchId: rt.id, state: 'NOT_READY', innings: [], result: null })));
}
