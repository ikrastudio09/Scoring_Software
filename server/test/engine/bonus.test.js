import { describe, expect, it } from 'vitest';
import { Sim, makeSetup, meta, A, B } from './helpers.js';
import { bonusPointWinner, bonusThresholds, normalizeBonus, toLiveView, toScorecard } from '../../src/engine/index.js';

const bonus = normalizeBonus();

describe('bonus point rules', () => {
  it('defending: target 60 → the chase must end below 45 (44 or less)', () => {
    expect(bonusThresholds(60, 48, bonus).defendMaxRuns).toBe(44);
    const first = { team: A, runs: 59 };
    const at = (runs) => bonusPointWinner(first, { team: B, runs, legalBalls: 48, maxBalls: 48 }, { type: 'win', winner: A }, bonus);
    expect(at(44)).toBe(A);
    expect(at(45)).toBeNull();
  });

  it('chasing: 8 overs → must win within 6.0 overs (36 balls)', () => {
    expect(bonusThresholds(60, 48, bonus).chaseWithinBalls).toBe(36);
    const first = { team: A, runs: 59 };
    const at = (legalBalls) => bonusPointWinner(first, { team: B, runs: 60, legalBalls, maxBalls: 48 }, { type: 'win', winner: B }, bonus);
    expect(at(36)).toBe(B);
    expect(at(37)).toBeNull();
  });

  it('no bonus for a Super Over win, a tie, or when disabled', () => {
    const first = { team: A, runs: 59 };
    const second = { team: B, runs: 10, legalBalls: 48, maxBalls: 48 };
    expect(bonusPointWinner(first, second, { type: 'win', winner: A, superOver: true }, bonus)).toBeNull();
    expect(bonusPointWinner(first, second, { type: 'tie' }, bonus)).toBeNull();
    expect(bonusPointWinner(first, second, { type: 'win', winner: A }, normalizeBonus({ enabled: false }))).toBeNull();
  });
});

describe('bonus point on the scorecard', () => {
  const m = (setup) => ({ ...meta(setup), bonus });
  // 8 overs, A makes 59 → target 60: chase bonus by 6.0 overs, defend bonus if B ends on 44 or less.
  const chase = () => {
    const s = new Sim(makeSetup({ oversPerInnings: 8, maxOversPerBowler: 8 })).start();
    for (let i = 0; i < 14; i++) { // 9 sixes and 5 singles = 59
      if (!s.inn.bowler) s.setBowler(s.inn.overs.length % 2 ? 'b2' : 'b1');
      if (i < 9) s.six(); else s.ball(1);
    }
    return s.do('END_INNINGS').start2();
  };
  const bowl = (s, fn) => {
    if (!s.inn.bowler) s.setBowler(s.inn.overs.length % 2 ? 'a2' : 'a1');
    fn();
  };

  it('shows both conditions while they can still be met, and drops each once it cannot', () => {
    const s = chase();
    let b = toLiveView(s.state, s.setup, m(s.setup)).bonus;
    expect(b.conditions.map((c) => [c.kind, c.team])).toEqual([['chase', B], ['defend', A]]);
    expect(b.conditions[0]).toMatchObject({ byOvers: '6.0', runsNeeded: 60, ballsLeft: 36 });
    expect(b.conditions[1]).toMatchObject({ maxRuns: 44 });

    for (let i = 0; i < 36; i++) bowl(s, () => s.ball(1)); // 36 off 36: chase window still open on the last ball
    expect(toLiveView(s.state, s.setup, m(s.setup)).bonus.conditions.map((c) => c.kind)).toEqual(['chase', 'defend']);
    bowl(s, () => s.ball(1)); // ball 37: chase window closed
    expect(toLiveView(s.state, s.setup, m(s.setup)).bonus.conditions.map((c) => c.kind)).toEqual(['defend']);
    for (let i = 0; i < 8; i++) bowl(s, () => s.ball(1)); // 45 runs: past the defend threshold
    expect(toLiveView(s.state, s.setup, m(s.setup)).bonus.conditions).toEqual([]);
  });

  it('records the award once the match ends', () => {
    const s = chase();
    for (let i = 0; i < 10; i++) bowl(s, () => s.six()); // 60 off 10 balls
    const sc = toScorecard(s.state, s.setup, m(s.setup));
    expect(sc.bonus).toMatchObject({ awardedTo: B, conditions: [{ kind: 'chase', status: 'achieved' }] });
  });

  it('is absent when the match does not count for bonus points', () => {
    const s = chase();
    expect(toLiveView(s.state, s.setup, meta(s.setup)).bonus).toBeNull();
  });
});
