// Pure display helpers shared by all clients. No cricket decisions are made here.

/** 27 legal balls, 6 per over → "4.3" */
export function formatOvers(legalBalls, ballsPerOver = 6) {
  const b = legalBalls || 0;
  return `${Math.floor(b / ballsPerOver)}.${b % ballsPerOver}`;
}

/** Runs per over, 2 decimals. Returns null when no balls bowled. */
export function runRate(runs, legalBalls, ballsPerOver = 6) {
  if (!legalBalls) return null;
  return Math.round((runs / legalBalls) * ballsPerOver * 100) / 100;
}

export function strikeRate(runs, balls) {
  if (!balls) return null;
  return Math.round((runs / balls) * 10000) / 100;
}

export function economy(runs, legalBalls, ballsPerOver = 6) {
  return runRate(runs, legalBalls, ballsPerOver);
}

export function average(runs, dismissals) {
  if (!dismissals) return null;
  return Math.round((runs / dismissals) * 100) / 100;
}

export function fixed(n, digits = 2) {
  return n === null || n === undefined || Number.isNaN(n) ? '-' : Number(n).toFixed(digits);
}

export function formatScore(runs, wickets) {
  return `${runs ?? 0}/${wickets ?? 0}`;
}

/** NRR with explicit sign, 3 decimals: "+1.234" */
export function formatNrr(nrr) {
  if (nrr === null || nrr === undefined || Number.isNaN(nrr)) return '-';
  const v = nrr.toFixed(3);
  return nrr > 0 ? `+${v}` : v;
}
