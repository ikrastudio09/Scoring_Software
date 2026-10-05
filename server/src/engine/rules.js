import {
  BOWLER_CREDITED, DELIVERY_DISMISSALS, EITHER_BATTER_DISMISSALS, FIELDER_DISMISSALS, FIELDER_REQUIRED,
} from '@cricket/shared';

export const DEFAULT_RULES = Object.freeze({
  oversPerInnings: 10,
  ballsPerOver: 6,
  maxOversPerBowler: 2,
  wideRuns: 1,
  noBallRuns: 1,
  freeHit: true,
});

// Which dismissals are possible on which kind of delivery (Laws 21, 22, 25, 35, 39).
const ON_WIDE = new Set(['stumped', 'run_out', 'hit_wicket', 'obstructing_field']);
const ON_NO_BALL = new Set(['run_out', 'obstructing_field', 'hit_ball_twice']);
const ON_FREE_HIT = new Set(['run_out', 'obstructing_field', 'hit_ball_twice']);
// Dismissals where the batters cannot have completed runs on the same delivery.
const NO_RUNS_ALLOWED = new Set(['bowled', 'caught', 'caught_and_bowled', 'lbw', 'stumped', 'hit_wicket', 'hit_ball_twice']);

export const isDeliveryDismissal = (type) => DELIVERY_DISMISSALS.includes(type);
export const isBowlerCredited = (type) => BOWLER_CREDITED.includes(type);
export const canDismissEitherBatter = (type) => EITHER_BATTER_DISMISSALS.includes(type);
export const allowsFielder = (type) => FIELDER_DISMISSALS.includes(type);
export const requiresFielder = (type) => FIELDER_REQUIRED.includes(type);
export const allowsRuns = (type) => !NO_RUNS_ALLOWED.has(type);

/** Returns an error message, or null if the dismissal is possible on this delivery. */
export function dismissalNotPossible(type, { extra, freeHit }) {
  if (extra === 'wide' && !ON_WIDE.has(type)) return `${type} is not possible off a wide`;
  if (extra === 'noball' && !ON_NO_BALL.has(type)) return `${type} is not possible off a no-ball`;
  if (freeHit && extra !== 'wide' && !ON_FREE_HIT.has(type)) return `${type} is not possible on a free hit`;
  return null;
}

export function normalizeRules(rules = {}) {
  const r = { ...DEFAULT_RULES, ...rules };
  for (const k of ['oversPerInnings', 'ballsPerOver', 'maxOversPerBowler']) {
    if (!Number.isInteger(r[k]) || r[k] < 1) throw new Error(`Invalid rule ${k}: ${r[k]}`);
  }
  for (const k of ['wideRuns', 'noBallRuns']) {
    if (!Number.isInteger(r[k]) || r[k] < 0) throw new Error(`Invalid rule ${k}: ${r[k]}`);
  }
  r.freeHit = Boolean(r.freeHit);
  return r;
}
