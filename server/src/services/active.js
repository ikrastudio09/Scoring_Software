// The active match. Business rule (spec §14): at most ONE match is in play at any time, across
// ALL categories (a Men's match being live blocks Ladies and Kids matches too).
//
// "In play" = LIVE, INNINGS_BREAK or SECOND_INNINGS. A match whose last ball has been bowled but
// whose result is not yet confirmed is still the active match (viewers keep seeing it, and its
// points/statistics are not final), so a new match cannot START until it is confirmed.
//
// Two layers of enforcement, both in the scoring pipeline before the event is committed:
//  1. a process-wide activation lock that serialises every transition into play and re-checks
//     the in-memory runtimes and MongoDB (fast, clear error messages);
//  2. the database lock: one ActiveLock document claimed with a conditional atomic update, so two
//     claims can never both succeed — even from two processes. It is released when the result is
//     confirmed (or an undo takes the match out of play) and repaired from the match documents
//     at startup, so a crash can never leave a stale lock behind.

import { ERROR_CODES, IN_PLAY_STATUSES, MATCH_STATUS } from '@cricket/shared';
import { ActiveLock, Match } from '../models/index.js';
import { logger } from '../utils/logger.js';
import { KeyedMutex } from '../utils/async.js';
import { conflict } from '../utils/errors.js';
import { cachedRuntimes } from './runtime.js';
import { getCategory } from './categories.js';

const IN_PLAY = new Set(IN_PLAY_STATUSES);
const FINISHED = [MATCH_STATUS.COMPLETED, MATCH_STATUS.ABANDONED];
const mutex = new KeyedMutex();

export const isInPlay = (status) => IN_PLAY.has(status);

/** Serialises every transition into play across all matches. */
export const withActivationLock = (fn) => mutex.run('activation', fn);

// Played to the end (or concluded) but the result is not confirmed yet.
const UNCONFIRMED = { status: { $in: FINISHED }, 'result.confirmed': { $ne: true }, stateVersion: { $gt: 0 } };

const LOCK_ID = 'global';

let cached; // undefined = unknown; null = no active match; otherwise { id, number, category, inPlay }

export function invalidateActiveMatch() { cached = undefined; }

/** The match viewers should be watching right now, or null. */
export async function getActiveMatch() {
  if (cached !== undefined) return cached;
  const inPlay = await Match.findOne({ status: { $in: IN_PLAY_STATUSES } }, 'number category').sort({ startedAt: -1 }).lean();
  const m = inPlay || await Match.findOne(UNCONFIRMED, 'number category').sort({ completedAt: -1 }).lean();
  cached = m ? { id: String(m._id), number: m.number, category: m.category ? String(m.category) : null, inPlay: Boolean(inPlay) } : null;
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
    ? { _id: mem.id, number: mem.match.number, category: mem.match.category }
    : await Match.findOne({ _id: { $ne: id }, status: { $in: IN_PLAY_STATUSES } }, 'number category').lean();
  if (other) throw await anotherLive(other);
  if (!starting) return;
  const pending = await Match.findOne({ _id: { $ne: id }, ...UNCONFIRMED }, 'number category').lean();
  if (pending) {
    throw conflict(
      `${(await describe(pending)).text} has finished but its result is not confirmed. Confirm it before starting the next match.`,
      ERROR_CODES.ANOTHER_MATCH_ACTIVE,
      { activeMatchId: String(pending._id), activeMatchNumber: pending.number },
    );
  }
}

async function describe(match) {
  let cat = null;
  try { cat = match.category ? await getCategory(match.category) : null; } catch { /* deleted category */ }
  const what = match.number != null ? `Match ${match.number}` : 'Another match';
  return { text: cat ? `${cat.name} ${what}` : what, cat };
}

async function anotherLive(match) {
  const { text, cat } = await describe(match);
  return conflict(
    `${text} is currently live. Only one match can be live at a time across all categories — complete it first.`,
    ERROR_CODES.ANOTHER_MATCH_ACTIVE,
    { activeMatchId: String(match._id ?? match.matchId), activeMatchNumber: match.number ?? null, activeCategory: cat ? { id: String(cat._id), key: cat.key, name: cat.name } : null },
  );
}

/**
 * Atomically claim the global lock for `match` (a lean match document). Succeeds when the lock is
 * free or already held by this match; otherwise throws ANOTHER_MATCH_ACTIVE.
 * Returns true when this call newly claimed it (the caller releases it if its commit fails).
 */
export async function claimActiveLock(match, user) {
  const id = match._id;
  let before;
  try {
    before = await ActiveLock.findOneAndUpdate(
      { _id: LOCK_ID, $or: [{ matchId: null }, { matchId: id }] },
      { $set: { matchId: id, category: match.category ?? null, number: match.number, claimedAt: new Date(), claimedBy: user?.username ?? null } },
      { upsert: true, new: false },
    ).lean();
  } catch (err) {
    // The filter did not match (held by another match) → the upsert collides with the existing _id.
    if (err?.code !== 11000) throw err;
    const lock = await ActiveLock.findById(LOCK_ID).lean();
    throw await anotherLive(lock || { matchId: null });
  }
  return !before || String(before.matchId) !== String(id);
}

/** Release the lock if (and only if) `matchId` holds it. Never throws. */
export async function releaseActiveLock(matchId) {
  try {
    await ActiveLock.updateOne({ _id: LOCK_ID, matchId }, { $set: { matchId: null, category: null, number: null, releasedAt: new Date() } });
  } catch (err) {
    logger.error({ err, matchId: String(matchId) }, 'failed to release the active-match lock (repaired at next startup)');
  }
}

export async function getActiveLock() {
  return ActiveLock.findById(LOCK_ID).lean();
}

/**
 * Make the lock agree with the match documents (startup, and admin "repair"): it must point at the
 * match in play, else at a played match whose result is unconfirmed, else be free.
 */
export async function repairActiveLock() {
  const inPlay = await Match.find({ status: { $in: IN_PLAY_STATUSES } }, 'number category startedAt').sort({ startedAt: -1 }).lean();
  if (inPlay.length > 1) {
    logger.error({ matches: inPlay.map((m) => m.number) }, 'more than one match is in play; the lock follows the most recently started');
  }
  // Otherwise a played match awaiting confirmation (this includes a match an admin reopened).
  const holder = inPlay[0] || await Match.findOne(UNCONFIRMED, 'number category').sort({ completedAt: -1 }).lean();
  const lock = await getActiveLock();
  const current = lock?.matchId ? String(lock.matchId) : null;
  const expected = holder ? String(holder._id) : null;
  if (current === expected && lock) return { changed: false, matchId: expected };
  await ActiveLock.updateOne({ _id: LOCK_ID }, {
    $set: holder
      ? { matchId: holder._id, category: holder.category ?? null, number: holder.number, claimedAt: new Date(), claimedBy: 'repair' }
      : { matchId: null, category: null, number: null, releasedAt: new Date() },
  }, { upsert: true });
  if (current !== expected) logger.warn({ from: current, to: expected }, 'active-match lock repaired from match documents');
  invalidateActiveMatch();
  return { changed: current !== expected, matchId: expected };
}
