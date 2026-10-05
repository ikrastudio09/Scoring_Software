// The scoring command pipeline. See docs/ARCHITECTURE.md "Scoring write path".

import { EVENT_TYPES, ERROR_CODES, MATCH_STATUS, formatOvers } from '@cricket/shared';
import { MatchEvent, Match } from '../models/index.js';
import { applyEvent, replay, currentInnings, toSummary, resultText, ScoringError } from '../engine/index.js';
import { AppError, conflict } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { metrics } from '../utils/metrics.js';
import { getRuntime, invalidateRuntime, scorerView, withMatchLock, undoLastEvent } from './runtime.js';
import { publishMatchUpdate } from '../realtime/hub.js';

const SCORING_STATUSES = new Set([
  MATCH_STATUS.READY, MATCH_STATUS.LIVE, MATCH_STATUS.INNINGS_BREAK, MATCH_STATUS.SECOND_INNINGS,
  MATCH_STATUS.COMPLETED, MATCH_STATUS.ABANDONED,
]);

export function deriveStatus(state) {
  switch (state.status) {
    case 'NOT_STARTED': return MATCH_STATUS.READY;
    case 'IN_PROGRESS': return state.innings.length === 1 ? MATCH_STATUS.LIVE : MATCH_STATUS.SECOND_INNINGS;
    case 'INNINGS_BREAK': return MATCH_STATUS.INNINGS_BREAK;
    case 'COMPLETED': return state.result?.type === 'abandoned' ? MATCH_STATUS.ABANDONED : MATCH_STATUS.COMPLETED;
    default: return MATCH_STATUS.READY;
  }
}

function contextOf(state, rules) {
  const inn = currentInnings(state);
  if (!inn) return { innings: 0 };
  return {
    innings: inn.number,
    over: formatOvers(inn.legalBalls, rules.ballsPerOver),
    score: `${inn.runs}/${inn.wickets}`,
    striker: inn.striker,
    nonStriker: inn.nonStriker,
    bowler: inn.bowler,
  };
}

const isDuplicateKey = (err) => err?.code === 11000;

/**
 * Execute one scoring command.
 * cmd = { type, payload, clientEventId?, expectedVersion? }
 * Returns { version, duplicate, effects, view }.
 */
export async function executeCommand(matchId, cmd, user) {
  const t0 = performance.now();
  let out;
  try {
    out = await withMatchLock(matchId, () => executeLocked(matchId, cmd, user));
  } catch (err) {
    if (err instanceof ScoringError || err.code === ERROR_CODES.STALE_STATE) metrics.scoringRejected();
    throw err;
  }
  const ms = performance.now() - t0;
  if (out.duplicate) {
    metrics.scoringDuplicate();
  } else {
    metrics.scoringCommand(ms, out.dbMs);
    logger.info({
      matchId: String(matchId), seq: out.version, type: cmd.type, label: out.label, effects: out.effects,
      user: user?.username, ms: +ms.toFixed(2), dbMs: +out.dbMs.toFixed(2),
    }, 'scoring event');
    // Fire-and-forget: the scorer's response never waits on fan-out.
    setImmediate(() => publishMatchUpdate(out.rt, { effects: out.effects, prevStatus: out.prevStatus }));
  }
  return { version: out.version, duplicate: out.duplicate, effects: out.effects, view: scorerView(out.rt) };
}

async function executeLocked(matchId, cmd, user) {
  let rt = await getRuntime(matchId);

  if (!rt.setup) {
    throw conflict('Complete the match setup (toss and playing XIs) first', ERROR_CODES.MATCH_NOT_STARTED);
  }
  if (rt.match.result?.confirmed) {
    throw conflict('The result has been confirmed. An admin must reopen the match to make corrections.', ERROR_CODES.MATCH_LOCKED);
  }
  if (!SCORING_STATUSES.has(rt.match.status)) {
    throw conflict(`Match is ${rt.match.status.toLowerCase()}`, ERROR_CODES.INVALID_TRANSITION);
  }

  // Idempotency: a retried request returns the current state and records nothing.
  if (cmd.clientEventId && rt.clientIds.has(cmd.clientEventId)) {
    return { rt, duplicate: true, version: rt.lastSeq, effects: [] };
  }
  // Optimistic concurrency: the scorer acted on a state that is no longer current
  // (double tap, second device, or a retried request after something else was recorded).
  if (cmd.expectedVersion !== undefined && cmd.expectedVersion !== null && cmd.expectedVersion !== rt.lastSeq) {
    throw new AppError(409, ERROR_CODES.STALE_STATE, 'The score changed since your last update. Screen refreshed — please check and retry.', {
      currentVersion: rt.lastSeq,
      view: scorerView(rt),
    });
  }

  const seq = rt.lastSeq + 1;
  let next;
  let effects;
  let effective;
  let doc;
  const base = {
    match: rt.match._id,
    seq,
    clientEventId: cmd.clientEventId || undefined,
    context: contextOf(rt.state, rt.setup.rules),
    user: user ? { id: String(user.id), username: user.username } : undefined,
    createdAt: new Date(),
  };

  if (cmd.type === EVENT_TYPES.UNDO) {
    const target = rt.effective[rt.effective.length - 1];
    if (!target) throw conflict('Nothing to undo', ERROR_CODES.NOTHING_TO_UNDO);
    effective = rt.effective.slice(0, -1);
    next = replay(rt.setup, effective);
    next.version = seq;
    next.lastEvent = undoLastEvent(target, seq);
    effects = ['UNDO'];
    doc = { ...base, type: EVENT_TYPES.UNDO, payload: {}, undoesSeq: target.seq, effects, label: `Undo ${target.label || target.type}` };
  } else {
    next = structuredClone(rt.state);
    effects = applyEvent(next, rt.setup, { type: cmd.type, payload: cmd.payload || {}, seq });
    doc = { ...base, type: cmd.type, payload: cmd.payload || {}, effects, label: next.lastEvent.label };
    effective = [...rt.effective, { seq, type: doc.type, payload: doc.payload, label: doc.label }];
  }

  // ── commit point: the journaled insert of the event ──
  const tDb = performance.now();
  try {
    await MatchEvent.create(doc);
  } catch (err) {
    if (!isDuplicateKey(err)) throw err;
    // Another writer got there first (or this is a retry that raced the original).
    invalidateRuntime(matchId);
    rt = await getRuntime(matchId);
    if (cmd.clientEventId && rt.clientIds.has(cmd.clientEventId)) {
      return { rt, duplicate: true, version: rt.lastSeq, effects: [] };
    }
    throw new AppError(409, ERROR_CODES.STALE_STATE, 'Another update was recorded at the same time. Screen refreshed — please retry.', {
      currentVersion: rt.lastSeq, view: scorerView(rt),
    });
  }
  const dbMs = performance.now() - tDb;

  if (cmd.type === EVENT_TYPES.UNDO) {
    // Audit convenience only; effective events are always derived from the UNDO records.
    MatchEvent.updateOne(
      { match: rt.match._id, seq: doc.undoesSeq },
      { $set: { undone: true, undoneAt: doc.createdAt, undoneBy: user?.username, undoneBySeq: seq } },
    ).catch((err) => logger.error({ err, matchId: rt.id }, 'failed to flag undone event'));
  }

  // ── in-memory commit ──
  const prevStatus = rt.match.status;
  rt.state = next;
  rt.effective = effective;
  rt.lastSeq = seq;
  if (cmd.clientEventId) rt.clientIds.add(cmd.clientEventId);
  rt.views = {};
  await syncMatchDocument(rt);

  return { rt, duplicate: false, version: seq, effects, prevStatus, dbMs, label: doc.label };
}

/** Write the derived fields onto the match document. Failure is logged, never fatal. */
export async function syncMatchDocument(rt) {
  const { state, setup, meta } = rt;
  const status = deriveStatus(state);
  const r = state.result;
  const set = {
    status,
    stateVersion: rt.lastSeq,
    summary: toSummary(state, setup, meta),
    'result.type': r?.type ?? null,
    'result.winner': r?.winner ?? null,
    'result.loser': r?.loser ?? null,
    'result.marginRuns': r?.marginRuns ?? null,
    'result.marginWickets': r?.marginWickets ?? null,
    'result.ballsRemaining': r?.ballsRemaining ?? null,
    'result.text': resultText(r, meta),
    completedAt: state.status === 'COMPLETED' ? (rt.match.completedAt || new Date()) : null,
  };
  if (state.innings.length && !rt.match.startedAt) set.startedAt = new Date();
  // Keep the in-memory copy in step with what we write.
  rt.match = {
    ...rt.match,
    status,
    stateVersion: rt.lastSeq,
    summary: set.summary,
    startedAt: set.startedAt ?? rt.match.startedAt,
    completedAt: set.completedAt,
    result: {
      ...rt.match.result,
      type: set['result.type'],
      winner: set['result.winner'],
      loser: set['result.loser'],
      marginRuns: set['result.marginRuns'],
      marginWickets: set['result.marginWickets'],
      ballsRemaining: set['result.ballsRemaining'],
      text: set['result.text'],
    },
  };
  try {
    // Derived data: no journal wait (reconcileMatches() repairs it after a crash).
    await Match.updateOne({ _id: rt.match._id }, { $set: set }, { writeConcern: { w: 1, j: false } });
  } catch (err) {
    logger.error({ err, matchId: rt.id }, 'failed to sync match document (events are safe; will resync on next event)');
  }
}

/**
 * Startup repair: if the process died between committing an event and syncing the match
 * document, the document is stale. Replay and resync every such match.
 */
export async function reconcileMatches() {
  const latest = await MatchEvent.aggregate([{ $group: { _id: '$match', lastSeq: { $max: '$seq' } } }]);
  let repaired = 0;
  for (const { _id, lastSeq } of latest) {
    const m = await Match.findById(_id, 'stateVersion').lean();
    if (!m || m.stateVersion === lastSeq) continue;
    await withMatchLock(_id, async () => {
      invalidateRuntime(_id);
      const rt = await getRuntime(_id);
      if (rt.state) await syncMatchDocument(rt);
    });
    repaired++;
    logger.warn({ matchId: String(_id), from: m.stateVersion, to: lastSeq }, 'match document resynced from event log');
  }
  return { checked: latest.length, repaired };
}
