import { describe, expect, it } from 'vitest';
import { DEFAULT_IMPACT_WEIGHTS, extractPlayerStats, impactContext, mergeWeights, scoreImpact } from '../../src/engine/index.js';
import { Sim, makeSetup } from './helpers.js';

const rowsOf = (sim) => {
  const ctx = impactContext(sim.state, sim.setup);
  return Object.fromEntries(extractPlayerStats(sim.state, sim.setup).map((r) => [r.playerId, { ...r, context: ctx[r.playerId] }]));
};

describe('impact score (MVP)', () => {
  it('follows the published formula exactly', () => {
    const row = {
      batting: { runs: 52, balls: 30, fours: 4, sixes: 3, out: true },
      bowling: { wickets: 2, runs: 18, legalBalls: 24, dots: 10, maidens: 1 },
      fielding: { catches: 1, runOuts: 1, stumpings: 0 },
      context: { parRunsPerBall: 1.2, topOrderWickets: 1, wonChase: false, wonDefending: true },
    };
    const w = DEFAULT_IMPACT_WEIGHTS;
    const batting = 52 + 4 + 3 * 2 + w.batting.fifty + (52 - 30 * 1.2) * 0.5;
    const bowling = 2 * 20 + 5 + 10 + 10 + (24 * 1.2 - 18) * 0.5;
    const fielding = 8 + 10;
    const context = bowling * 0.1;
    const s = scoreImpact(row);
    expect(s.batting).toBeCloseTo(batting, 1);
    expect(s.bowling).toBeCloseTo(bowling, 1);
    expect(s.fielding).toBe(fielding);
    expect(s.context).toBeCloseTo(context, 1);
    expect(s.total).toBeCloseTo(batting + bowling + fielding + context, 0);
    expect(s.reasons).toEqual(expect.arrayContaining(['52 off 30 (4×4, 3×6)', '2/18, 10 dots, 1 maiden', '1 catch, 1 run out', 'defended the total']));
  });

  it('rewards fast scoring and economical bowling relative to the match, and never goes below zero', () => {
    const ctx = { parRunsPerBall: 1.5, topOrderWickets: 0 };
    const quick = scoreImpact({ batting: { runs: 20, balls: 8, fours: 0, sixes: 0, out: false }, context: ctx });
    const slow = scoreImpact({ batting: { runs: 20, balls: 30, fours: 0, sixes: 0, out: false }, context: ctx });
    expect(quick.total).toBeGreaterThan(slow.total);
    const tight = scoreImpact({ bowling: { wickets: 0, runs: 12, legalBalls: 12, dots: 0, maidens: 0 }, context: ctx });
    const costly = scoreImpact({ bowling: { wickets: 0, runs: 40, legalBalls: 12, dots: 0, maidens: 0 }, context: ctx });
    expect(tight.total).toBeGreaterThan(costly.total);
    expect(costly.total).toBe(0);
  });

  it('weights are configurable and auction value is not an input', () => {
    const row = { batting: { runs: 10, balls: 10, fours: 0, sixes: 0, out: false }, context: { parRunsPerBall: 1, topOrderWickets: 0 } };
    expect(scoreImpact(row).total).toBe(10);
    expect(scoreImpact(row, mergeWeights({ batting: { run: 2 } })).total).toBe(20);
    expect(scoreImpact({ ...row, soldPoints: 9_000_000, auction: { soldPoints: 9_000_000 } }).total).toBe(10);
    expect(mergeWeights({ batting: { run: 'x', bogus: 5 } }).batting).toEqual(DEFAULT_IMPACT_WEIGHTS.batting);
  });

  it('derives match context from the engine state: top-order wickets and the winning chase', () => {
    const sim = new Sim(makeSetup({ oversPerInnings: 1 })).start();
    sim.out('bowled').newBatter('a3').ball(1).ball(0).ball(0).ball(0).ball(0); // 1/1
    sim.start2().ball(1).ball(1); // 2/0 → chase won
    const rows = rowsOf(sim);
    expect(rows.b1.context.topOrderWickets).toBe(1);
    expect(rows.b1.context.wonChase).toBe(true);
    expect(rows.a1.context.wonChase).toBe(false);
    expect(rows.b1.context.parRunsPerBall).toBeCloseTo(3 / 8, 4);
    const top = Object.values(rows).map((r) => ({ id: r.playerId, ...scoreImpact(r) })).sort((a, b) => b.total - a.total)[0];
    expect(top.id).toBe('b1'); // a wicket and a winning chase contribution
  });
});
