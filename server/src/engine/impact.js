// Player impact score (MVP). Transparent, deterministic and configurable — no AI.
//
// Two steps so that changing the weights never needs a statistics rebuild:
//   impactContext(state, setup)  per-player match facts (stored with the derived statistics)
//   scoreImpact(row, weights)    points = Σ facts × weights, with a human-readable breakdown
//
// The formula, per match:
//   batting   runs × run + fours × four + sixes × six + milestone bonuses
//             + (runs − balls × matchRunsPerBall) × runsAbovePar      ← scoring tempo vs this match
//             + duck penalty
//   bowling   wickets × wicket + top-order (1–4) wickets × topOrderWicket + dots × dot
//             + maidens × maiden + 3-wicket bonus
//             + (balls × matchRunsPerBall − runsConceded) × runsSavedVsPar  ← economy vs this match
//   fielding  catches × catch + run outs × runOut + stumpings × stumping
//   context   successful chase: +chaseWinPct % of batting points;
//             successful defence: +defendWinPct % of bowling points
//   total     max(0, sum), one decimal
// Auction value is NEVER an input (spec §39, rule 20).

export const DEFAULT_IMPACT_WEIGHTS = Object.freeze({
  batting: { run: 1, four: 1, six: 2, fifty: 8, hundred: 16, runsAbovePar: 0.5, duck: -3 },
  bowling: { wicket: 20, topOrderWicket: 5, dot: 1, maiden: 10, threeWickets: 8, runsSavedVsPar: 0.5 },
  fielding: { catch: 8, runOut: 10, stumping: 10 },
  context: { chaseWinPct: 10, defendWinPct: 10 },
});

export function mergeWeights(custom) {
  const out = {};
  for (const [group, defaults] of Object.entries(DEFAULT_IMPACT_WEIGHTS)) {
    out[group] = { ...defaults };
    for (const k of Object.keys(defaults)) {
      const v = custom?.[group]?.[k];
      if (typeof v === 'number' && Number.isFinite(v)) out[group][k] = v;
    }
  }
  return out;
}

/** Per-player match facts the formula needs beyond the scorecard row. */
export function impactContext(state, setup) {
  const innings = state.innings.filter((i) => !i.superOver); // as in extractPlayerStats
  const balls = innings.reduce((s, i) => s + i.legalBalls, 0);
  const runs = innings.reduce((s, i) => s + i.runs, 0);
  const parRunsPerBall = balls ? runs / balls : 0;
  const result = state.result?.superOver ? null : state.result;
  const second = innings[1];
  const chaseWon = Boolean(result?.type === 'win' && second && result.winner === second.battingTeam);
  const defendWon = Boolean(result?.type === 'win' && second && result.winner === second.bowlingTeam);

  const ctx = {};
  for (const team of [setup.battingFirst, setup.bowlingFirst]) {
    for (const id of setup.xi[team]) {
      ctx[id] = {
        parRunsPerBall: Math.round(parRunsPerBall * 10000) / 10000,
        topOrderWickets: 0,
        wonChase: chaseWon && team === second.battingTeam,
        wonDefending: defendWon && team === second.bowlingTeam,
      };
    }
  }
  for (const inn of innings) {
    for (const id of inn.battingOrder) {
      const b = inn.batters[id];
      if (b.status === 'out' && b.dismissal?.bowler && b.position <= 4) ctx[b.dismissal.bowler].topOrderWickets += 1;
    }
  }
  return ctx;
}

const r1 = (n) => Math.round(n * 10) / 10;
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

/**
 * row = { batting, bowling, fielding, context } (a PlayerMatchStat-shaped object)
 * Returns { total, batting, bowling, fielding, context, reasons[] }.
 */
export function scoreImpact(row, weights = DEFAULT_IMPACT_WEIGHTS) {
  const w = weights;
  const c = row.context || { parRunsPerBall: 0, topOrderWickets: 0 };
  const reasons = [];
  let batting = 0;
  let bowling = 0;

  const b = row.batting;
  if (b) {
    batting += b.runs * w.batting.run + b.fours * w.batting.four + b.sixes * w.batting.six;
    if (b.runs >= 100) batting += w.batting.hundred;
    else if (b.runs >= 50) batting += w.batting.fifty;
    const abovePar = b.runs - b.balls * c.parRunsPerBall;
    batting += abovePar * w.batting.runsAbovePar;
    if (b.out && b.runs === 0) batting += w.batting.duck;
    if (b.runs || b.balls) {
      reasons.push(`${b.runs}${b.out ? '' : '*'} off ${b.balls}${b.fours || b.sixes ? ` (${b.fours}×4, ${b.sixes}×6)` : ''}`);
      if (b.balls >= 6 && Math.abs(abovePar) >= 3) reasons.push(`${abovePar > 0 ? '+' : ''}${r1(abovePar)} runs vs match scoring rate`);
    }
  }

  const o = row.bowling;
  if (o) {
    bowling += o.wickets * w.bowling.wicket + c.topOrderWickets * w.bowling.topOrderWicket
      + o.dots * w.bowling.dot + o.maidens * w.bowling.maiden;
    if (o.wickets >= 3) bowling += w.bowling.threeWickets;
    const saved = o.legalBalls * c.parRunsPerBall - o.runs;
    bowling += saved * w.bowling.runsSavedVsPar;
    reasons.push(`${o.wickets}/${o.runs}${o.dots ? `, ${plural(o.dots, 'dot')}` : ''}${o.maidens ? `, ${plural(o.maidens, 'maiden')}` : ''}`);
    if (c.topOrderWickets) reasons.push(`${plural(c.topOrderWickets, 'top-order wicket')}`);
    if (o.legalBalls >= 6 && Math.abs(saved) >= 3) reasons.push(`${saved > 0 ? `${r1(saved)} runs saved` : `${r1(-saved)} runs over`} vs match scoring rate`);
  }

  const f = row.fielding || {};
  const fielding = (f.catches || 0) * w.fielding.catch + (f.runOuts || 0) * w.fielding.runOut + (f.stumpings || 0) * w.fielding.stumping;
  const fParts = [[f.catches, 'catch', 'catches'], [f.runOuts, 'run out', 'run outs'], [f.stumpings, 'stumping', 'stumpings']]
    .filter(([n]) => n).map(([n, one, many]) => `${n} ${n === 1 ? one : many}`);
  if (fParts.length) reasons.push(fParts.join(', '));

  let context = 0;
  if (c.wonChase && batting > 0) { context += batting * (w.context.chaseWinPct / 100); reasons.push('in a winning chase'); }
  if (c.wonDefending && bowling > 0) { context += bowling * (w.context.defendWinPct / 100); reasons.push('defended the total'); }

  const total = Math.max(0, batting + bowling + fielding + context);
  return { total: r1(total), batting: r1(batting), bowling: r1(bowling), fielding: r1(fielding), context: r1(context), reasons };
}
