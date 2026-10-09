// Bonus point for a dominant win. Pure; shared by the points table and the live/scorecard views.
//
// The winner earns `points` extra when either
//   defending: the chasing side finishes below `runsPercent` % of the target
//              (target 60, 75 % → the chase must end on 44 or less), or
//   chasing:   the target is reached within `oversPercent` % of the chasing side's overs
//              (8 overs, 75 % → by 6.0 overs, i.e. within 36 legal balls).
// Ties, Super Over wins, walkovers and no-results never carry a bonus.

import { formatOvers } from '@cricket/shared';

export const DEFAULT_BONUS = Object.freeze({ enabled: true, points: 1, runsPercent: 75, oversPercent: 75 });

export function normalizeBonus(bonus) {
  const b = { ...DEFAULT_BONUS };
  for (const [k, v] of Object.entries(bonus || {})) if (v !== undefined && v !== null) b[k] = v;
  b.enabled = Boolean(b.enabled);
  return b;
}

/** target = runs needed to win; maxBalls = the chasing side's full quota of legal balls. */
export function bonusThresholds(target, maxBalls, bonus) {
  const below = (target * bonus.runsPercent) / 100;
  return {
    // Highest chasing score that still gives the defending side its bonus.
    defendMaxRuns: Math.ceil(below) - 1,
    // Latest legal ball by which a successful chase earns the bonus.
    chaseWithinBalls: Math.floor((maxBalls * bonus.oversPercent) / 100),
  };
}

/**
 * The team that earned the bonus point, or null.
 * first/second = { team, runs, legalBalls, maxBalls } (the two main innings, in order)
 * result = { type, winner, superOver }
 */
export function bonusPointWinner(first, second, result, bonus) {
  if (!bonus?.enabled || !first || !second || result?.type !== 'win' || result.superOver) return null;
  const t = bonusThresholds(first.runs + 1, second.maxBalls, bonus);
  if (result.winner === second.team) return second.legalBalls <= t.chaseWithinBalls ? second.team : null;
  if (result.winner === first.team) return second.runs <= t.defendMaxRuns ? first.team : null;
  return null;
}

/**
 * What the scorecard shows: each bonus condition that can still be met (`live`) or was met
 * (`achieved`). A condition drops out as soon as it can no longer be met.
 * Returns null when bonus points do not apply to this match.
 */
export function bonusStatus(state, bonus, bpo, teamName) {
  if (!bonus?.enabled) return null;
  const [first, second] = state.innings;
  const base = { points: bonus.points, runsPercent: bonus.runsPercent, oversPercent: bonus.oversPercent, awardedTo: null, conditions: [] };
  // A tie goes to a Super Over (or is shared): no bonus either way.
  if (state.innings.length > 2 || state.result?.superOver) return base;
  if (state.result && state.result.type !== 'win') return base;

  if (!first || first.status !== 'COMPLETED') {
    base.conditions.push({ kind: 'rule', status: 'live', text: `Win by restricting the chase below ${bonus.runsPercent}% of the target, or chase it within ${bonus.oversPercent}% of the overs` });
    return base;
  }

  const target = first.runs + 1;
  const chaseBalls = second?.maxBalls ?? first.maxBalls; // before the chase starts, both quotas are equal
  const t = bonusThresholds(target, chaseBalls, bonus);
  const chasing = first.bowlingTeam;
  const defending = first.battingTeam;
  const runs = second?.runs ?? 0;
  const balls = second?.legalBalls ?? 0;

  if (state.result) {
    const winner = bonusPointWinner(
      { team: first.battingTeam, runs: first.runs },
      { team: second.battingTeam, runs: second.runs, legalBalls: second.legalBalls, maxBalls: second.maxBalls },
      state.result, bonus,
    );
    if (winner) {
      base.awardedTo = winner;
      base.conditions.push(winner === chasing
        ? { kind: 'chase', team: chasing, status: 'achieved', text: `${teamName(chasing)} chased ${target} in ${formatOvers(balls, bpo)} overs (needed by ${formatOvers(t.chaseWithinBalls, bpo)})` }
        : { kind: 'defend', team: defending, status: 'achieved', text: `${teamName(defending)} held ${teamName(chasing)} to ${runs} (needed ${t.defendMaxRuns} or less)` });
    }
    return base;
  }

  if (balls <= t.chaseWithinBalls) {
    const left = t.chaseWithinBalls - balls;
    base.conditions.push({
      kind: 'chase', team: chasing, status: 'live', byOvers: formatOvers(t.chaseWithinBalls, bpo), runsNeeded: Math.max(target - runs, 0), ballsLeft: left,
      text: `${teamName(chasing)} must reach ${target} by ${formatOvers(t.chaseWithinBalls, bpo)} overs — ${Math.max(target - runs, 0)} needed from ${left} ball${left === 1 ? '' : 's'}`,
    });
  }
  if (runs <= t.defendMaxRuns) {
    base.conditions.push({
      kind: 'defend', team: defending, status: 'live', maxRuns: t.defendMaxRuns,
      text: `${teamName(defending)} must win and hold ${teamName(chasing)} to ${t.defendMaxRuns} or less (${bonus.runsPercent}% of ${target})`,
    });
  }
  return base;
}
