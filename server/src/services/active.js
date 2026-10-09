// The active match. Business rule (spec §14): at most ONE match is in play at any time.
//
// "In play" = LIVE, INNINGS_BREAK or SECOND_INNINGS. A match whose last ball has been bowled but
// whose result is not yet confirmed is still the active match (viewers keep seeing it, and its
// points/statistics are not final), so a new match cannot START until it is confirmed.
//
// Enforcement happens in the scoring pipeline: any command that would move a match INTO play
// runs under one process-wide activation lock that re-checks the database (and the in-memory
// runtimes) first. The deployment is a single Node process (see docs/DEPLOYMENT.md), so an
// in-process lock is sufficient.

import { ERROR_CODES, IN_PLAY_STATUSES, MATCH_STATUS } from '@cricket/shared';
import { Match } from '../models/index.js';
import { KeyedMutex } from '../utils/async.js';
import { conflict } from '../utils/errors.js';
import { cachedRuntimes } from './runtime.js';

const IN_PLAY = new Set(IN_PLAY_STATUSES);
const FINISHED = [MATCH_STATUS.COMPLETED, MATCH_STATUS.ABANDONED];
const mutex = new KeyedMutex();

export const isInPlay = (status) => IN_PLAY.has(status);

/** Serialises every transition into play across all matches. */
export const withActivationLock = (fn) => mutex.run('activation', fn);

// Played to the end (or concluded) but the result is not confirmed yet.
const UNCONFIRMED = { status: { $in: FINISHED }, 'result.confirmed': { $ne: true }, stateVersion: { $gt: 0 } };

let cached; // undefined = unknown; null = no active match; otherwise { id, number }

export function invalidateActiveMatch() { cached = undefined; }

/** The match viewers should be watching right now, or null. */
export async function getActiveMatch() {
  if (cached !== undefined) return cached;
  const inPlay = await Match.findOne({ status: { $in: IN_PLAY_STATUSES } }, 'number').sort({ startedAt: -1 }).lean();
  const m = inPlay || await Match.findOne(UNCONFIRMED, 'number').sort({ completedAt: -1 }).lean();
  cached = m ? { id: String(m._id), number: m.number, inPlay: Boolean(inPlay) } : null;
  return cached;
}

/**
 * Throws ANOTHER_MATCH_ACTIVE unless `matchId` may enter play. Call inside withActivationLock.
 * starting = this is the first ball of the match (innings 1 starting): additionally requires
 * every earlier finished match to be confirmed.
 */
export async function assertCanGoLive(matchId, { starting }) {
  const id = String(matchId);
  // In-memory runtimes first: they are updated before the (non-fatal) match-document sync.
  const mem = cachedRuntimes().find((rt) => rt.id !== id && isInPlay(rt.match.status));
  const other = mem
    ? { _id: mem.id, number: mem.match.number }
    : await Match.findOne({ _id: { $ne: id }, status: { $in: IN_PLAY_STATUSES } }, 'number').lean();
  if (other) {
    throw conflict(
      `Match ${other.number} is currently live. Only one match can be live at a time — complete it first.`,
      ERROR_CODES.ANOTHER_MATCH_ACTIVE,
      { activeMatchId: String(other._id), activeMatchNumber: other.number },
    );
  }
  if (!starting) return;
  const pending = await Match.findOne({ _id: { $ne: id }, ...UNCONFIRMED }, 'number').lean();
  if (pending) {
    throw conflict(
      `Match ${pending.number} has finished but its result is not confirmed. Confirm it before starting the next match.`,
      ERROR_CODES.ANOTHER_MATCH_ACTIVE,
      { activeMatchId: String(pending._id), activeMatchNumber: pending.number },
    );
  }
}
