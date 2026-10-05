import { describe, it, expect } from 'vitest';
import { ERROR_CODES as E } from '@cricket/shared';
import { Sim, makeSetup, meta, expectScoringError, A, B } from './helpers.js';
import { toLiveView, toScorecard, toScorerView, extractPlayerStats, resultText, MATCH_STATE } from '../../src/engine/index.js';

describe('runs', () => {
  it.each([0, 1, 2, 3, 4, 5, 6])('%i run(s) credited to batter, team and bowler', (r) => {
    const s = new Sim().start().ball(r);
    expect(s.inn.runs).toBe(r);
    const scorer = s.state.innings[0].batters.a1;
    expect(scorer.runs).toBe(r);
    expect(scorer.balls).toBe(1);
    expect(s.bowler('b1')).toMatchObject({ runs: r, legalBalls: 1, dots: r === 0 ? 1 : 0 });
    expect(s.inn.legalBalls).toBe(1);
    expect(s.inn.extras.total).toBe(0);
  });

  it('boundaries count as 4s and 6s; run fours do not', () => {
    const s = new Sim().start().four().six().ball(4);
    expect(s.batter('a1')).toMatchObject({ runs: 14, fours: 1, sixes: 1 });
    expect(s.bowler('b1')).toMatchObject({ fours: 1, sixes: 1 });
  });

  it('rejects impossible run values', () => {
    const s = new Sim().start();
    expectScoringError(() => s.ball(8), E.INVALID_DELIVERY);
    expectScoringError(() => s.ball(-1), E.INVALID_DELIVERY);
    expectScoringError(() => s.ball(3, { boundary: true }), E.INVALID_DELIVERY);
    expect(s.inn.legalBalls).toBe(0);
  });
});

describe('strike rotation', () => {
  it('odd runs swap strike, even runs do not', () => {
    const s = new Sim().start().ball(1);
    expect(s.inn.striker).toBe('a2');
    s.ball(2);
    expect(s.inn.striker).toBe('a2');
    s.ball(3);
    expect(s.inn.striker).toBe('a1');
    s.four();
    expect(s.inn.striker).toBe('a1');
  });

  it('5 runs (overthrows) swap strike', () => {
    const s = new Sim().start().ball(5);
    expect(s.inn.striker).toBe('a2');
  });

  it('end of over swaps strike', () => {
    const s = new Sim().start().dots(6);
    expect(s.inn.striker).toBe('a2');
    expect(s.inn.nonStriker).toBe('a1');
    expect(s.inn.bowler).toBeNull();
    expect(s.lastEffects).toContain('OVER_COMPLETED');
  });

  it('single off the last ball keeps the batter on strike for the next over', () => {
    const s = new Sim().start().dots(5).ball(1);
    expect(s.inn.striker).toBe('a1');
  });

  it('wide with runs completed rotates strike', () => {
    const s = new Sim().start().wide(1);
    expect(s.inn.striker).toBe('a2');
    s.wide(0);
    expect(s.inn.striker).toBe('a2');
  });

  it('no-ball with a run off the bat rotates strike', () => {
    const s = new Sim().start().noball(1);
    expect(s.inn.striker).toBe('a2');
  });

  it('manual swap is available as a correction', () => {
    const s = new Sim().start().do('SWAP_STRIKE');
    expect(s.inn.striker).toBe('a2');
  });
});

describe('extras', () => {
  it('wide: penalty to wides and bowler, not a ball faced, not legal', () => {
    const s = new Sim().start().wide();
    expect(s.inn).toMatchObject({ runs: 1, legalBalls: 0 });
    expect(s.inn.extras).toMatchObject({ wides: 1, total: 1 });
    expect(s.batter('a1').balls).toBe(0);
    expect(s.bowler('b1')).toMatchObject({ runs: 1, wides: 1, legalBalls: 0, dots: 0 });
    expect(s.inn.overs[0].balls[0].label).toBe('Wd');
  });

  it('multiple runs on a wide are all wides', () => {
    const s = new Sim().start().wide(2).wide(4, { boundary: true });
    expect(s.inn.runs).toBe(3 + 5);
    expect(s.inn.extras.wides).toBe(8);
    expect(s.bowler('b1').runs).toBe(8);
    expect(s.batter('a1').runs + s.batter('a2').runs).toBe(0);
    expect(s.inn.overs[0].balls.map((b) => b.label)).toEqual(['3Wd', '5Wd']);
  });

  it('wide does not count toward the over: 6 legal balls still needed', () => {
    const s = new Sim().start().wide().dots(5);
    expect(s.inn.overs[0].completed).toBe(false);
    s.ball(0);
    expect(s.inn.overs[0].completed).toBe(true);
    expect(s.inn.overs[0].balls).toHaveLength(7);
  });

  it('no-ball: penalty to bowler, counts as ball faced, not legal', () => {
    const s = new Sim().start().noball();
    expect(s.inn).toMatchObject({ runs: 1, legalBalls: 0 });
    expect(s.inn.extras.noBalls).toBe(1);
    expect(s.batter('a1').balls).toBe(1);
    expect(s.bowler('b1')).toMatchObject({ runs: 1, noBalls: 1, legalBalls: 0 });
  });

  it('no-ball + runs off the bat: runs to batter and bowler, penalty to extras', () => {
    const s = new Sim().start().noball(4, { boundary: true });
    expect(s.inn.runs).toBe(5);
    expect(s.batter('a1')).toMatchObject({ runs: 4, fours: 1, balls: 1 });
    expect(s.bowler('b1').runs).toBe(5);
    expect(s.inn.extras).toMatchObject({ noBalls: 1, total: 1 });
    expect(s.inn.overs[0].balls[0].label).toBe('Nb+4');
  });

  it('no-ball + byes: byes are extras and not charged to the bowler', () => {
    const s = new Sim().start().noball(2, { noBallRunsType: 'bye' });
    expect(s.inn.runs).toBe(3);
    expect(s.inn.extras).toMatchObject({ noBalls: 1, byes: 2, total: 3 });
    expect(s.batter('a1').runs).toBe(0);
    expect(s.bowler('b1').runs).toBe(1);
  });

  it('byes and leg byes: legal, faced, not charged to the bowler, dot for the bowler', () => {
    const s = new Sim().start().bye(2).legbye(1);
    expect(s.inn).toMatchObject({ runs: 3, legalBalls: 2 });
    expect(s.inn.extras).toMatchObject({ byes: 2, legByes: 1, total: 3 });
    expect(s.batter('a1')).toMatchObject({ runs: 0, balls: 2 });
    expect(s.bowler('b1')).toMatchObject({ runs: 0, legalBalls: 2, dots: 2 });
    expect(s.inn.striker).toBe('a2'); // 1 leg bye rotated
  });

  it('boundary byes count 4 to extras, not to the batter', () => {
    const s = new Sim().start().ball(4, { extra: 'bye', boundary: true });
    expect(s.inn.extras.byes).toBe(4);
    expect(s.batter('a1').fours).toBe(0);
  });

  it('a six cannot be byes', () => {
    const s = new Sim().start();
    expectScoringError(() => s.ball(6, { extra: 'bye', boundary: true }), E.INVALID_DELIVERY);
  });

  it('respects configured penalty values', () => {
    const s = new Sim(makeSetup({ wideRuns: 2, noBallRuns: 2 })).start().wide().noball();
    expect(s.inn.runs).toBe(4);
    expect(s.bowler('b1').runs).toBe(4);
  });

  it('maiden ignores byes but not wides', () => {
    const s = new Sim(makeSetup({ oversPerInnings: 4 })).start().bye(1).dots(5);
    expect(s.bowler('b1').maidens).toBe(1);
    s.setBowler('b2').wide().dots(6);
    expect(s.bowler('b2').maidens).toBe(0);
  });
});

describe('free hit', () => {
  it('follows a no-ball, survives a wide, ends after a legal ball', () => {
    const s = new Sim().start().noball();
    expect(s.inn.freeHit).toBe(true);
    expect(s.lastEffects).toContain('FREE_HIT');
    s.wide();
    expect(s.inn.freeHit).toBe(true);
    s.ball(1);
    expect(s.inn.freeHit).toBe(false);
  });

  it('only run out is possible on a free hit', () => {
    const s = new Sim().start().noball();
    expectScoringError(() => s.out('bowled'), E.INVALID_WICKET);
    expectScoringError(() => s.out('caught', { fielderId: 'b2' }), E.INVALID_WICKET);
    s.out('run_out', { runs: 1, batterId: 'a1', fielderId: 'b3' });
    expect(s.inn.wickets).toBe(1);
  });

  it('can be disabled', () => {
    const s = new Sim(makeSetup({ freeHit: false })).start().noball();
    expect(s.inn.freeHit).toBe(false);
  });
});

describe('wickets', () => {
  it('bowled: striker out, bowler credited, slot vacated, new batter required', () => {
    const s = new Sim().start().out('bowled');
    expect(s.inn.wickets).toBe(1);
    expect(s.batter('a1')).toMatchObject({ status: 'out', balls: 1 });
    expect(s.batter('a1').dismissal).toMatchObject({ type: 'bowled', bowler: 'b1' });
    expect(s.bowler('b1').wickets).toBe(1);
    expect(s.inn.striker).toBeNull();
    expect(s.lastEffects).toContain('WICKET');
    expectScoringError(() => s.ball(0), E.BATTER_REQUIRED);
    s.newBatter('a3');
    expect(s.inn.striker).toBe('a3');
    expect(s.batter('a3').position).toBe(3);
  });

  it('caught requires a fielder and the new batter takes strike', () => {
    const s = new Sim().start().ball(1); // a2 on strike
    expectScoringError(() => s.out('caught'), E.INVALID_WICKET);
    s.out('caught', { fielderId: 'b5' }).newBatter('a3');
    expect(s.inn.striker).toBe('a3');
    expect(s.inn.nonStriker).toBe('a1');
    expect(s.batter('a2').dismissal).toMatchObject({ type: 'caught', fielder: 'b5', bowler: 'b1' });
  });

  it('caught by a substitute fielder', () => {
    const s = new Sim().start().out('caught', { substituteFielder: true });
    expect(toScorecard(s.state, s.setup, meta(s.setup)).innings[0].batting[0].dismissal).toBe('c sub b B1');
  });

  it('caught & bowled credits the bowler as fielder', () => {
    const s = new Sim().start().out('caught_and_bowled');
    expect(s.batter('a1').dismissal).toMatchObject({ fielder: 'b1', bowler: 'b1' });
  });

  it('lbw, stumped and hit wicket credit the bowler', () => {
    const s = new Sim(makeSetup({ oversPerInnings: 3 })).start().out('lbw').newBatter('a3').out('stumped', { fielderId: 'b11' })
      .newBatter('a4').out('hit_wicket');
    expect(s.bowler('b1').wickets).toBe(3);
    expect(s.inn.wickets).toBe(3);
  });

  it('runs are not possible on bowled / caught / lbw', () => {
    const s = new Sim().start();
    expectScoringError(() => s.out('bowled', { runs: 1 }), E.INVALID_WICKET);
    expectScoringError(() => s.out('caught', { runs: 2, fielderId: 'b2' }), E.INVALID_WICKET);
    expectScoringError(() => s.out('lbw', { runs: 1 }), E.INVALID_WICKET);
  });

  it('run out of the non-striker after a completed run: runs count, bowler not credited', () => {
    const s = new Sim().start().out('run_out', { runs: 1, batterId: 'a2', fielderId: 'b4' });
    expect(s.inn.runs).toBe(1);
    expect(s.batter('a1').runs).toBe(1);
    expect(s.batter('a2').status).toBe('out');
    expect(s.bowler('b1').wickets).toBe(0);
    // batters crossed once: a1 is now at the non-striker's end, a2's (striker's) end is vacant
    expect(s.inn.striker).toBeNull();
    expect(s.inn.nonStriker).toBe('a1');
    s.newBatter('a3');
    expect(s.inn.striker).toBe('a3');
  });

  it('run out of the striker with no run: new batter at striker end', () => {
    const s = new Sim().start().out('run_out', { batterId: 'a1' }).newBatter('a3');
    expect(s.inn.striker).toBe('a3');
    expect(s.inn.nonStriker).toBe('a2');
  });

  it('run out must name a batter at the crease', () => {
    const s = new Sim().start();
    expectScoringError(() => s.out('run_out', { batterId: 'a7' }), E.INVALID_WICKET);
  });

  it('only the striker can be out bowled', () => {
    const s = new Sim().start();
    expectScoringError(() => s.out('bowled', { batterId: 'a2' }), E.INVALID_WICKET);
  });

  it('stumped and run out are possible off a wide; bowled is not', () => {
    const s = new Sim().start();
    expectScoringError(() => s.out('bowled', { extra: 'wide' }), E.INVALID_WICKET);
    s.out('stumped', { extra: 'wide', fielderId: 'b11' });
    expect(s.inn.runs).toBe(1);
    expect(s.inn.extras.wides).toBe(1);
    expect(s.inn.legalBalls).toBe(0);
    expect(s.bowler('b1').wickets).toBe(1);
    expect(s.inn.overs[0].balls[0].label).toBe('Wd+W');
  });

  it('no-ball: only run out', () => {
    const s = new Sim().start();
    expectScoringError(() => s.out('stumped', { extra: 'noball' }), E.INVALID_WICKET);
    s.out('run_out', { extra: 'noball', runs: 1, batterId: 'a2' });
    expect(s.inn.runs).toBe(2);
  });

  it('fielder must be in the fielding XI and only for fielding dismissals', () => {
    const s = new Sim().start();
    expectScoringError(() => s.out('caught', { fielderId: 'a5' }), E.INVALID_WICKET);
    expectScoringError(() => s.out('bowled', { fielderId: 'b5' }), E.INVALID_WICKET);
  });

  it('wicket on the last ball of the over: new batter comes in at the non-striker end', () => {
    const s = new Sim(makeSetup({ oversPerInnings: 3 })).start().dots(5).out('bowled');
    expect(s.inn.striker).toBe('a2');
    expect(s.inn.nonStriker).toBeNull();
    s.newBatter('a3').setBowler('b2');
    expect(s.inn.nonStriker).toBe('a3');
    expect(s.inn.striker).toBe('a2');
  });

  it('dismissed batter cannot return; new batter must be in XI', () => {
    const s = new Sim().start().out('bowled');
    expectScoringError(() => s.newBatter('a1'), E.INVALID_PLAYER);
    expectScoringError(() => s.newBatter('b3'), E.INVALID_PLAYER);
    expectScoringError(() => s.newBatter('a2'), E.INVALID_PLAYER);
  });

  it('new batter rejected when both batters are in', () => {
    const s = new Sim().start();
    expectScoringError(() => s.newBatter('a3'), E.INVALID_STRIKE_STATE);
  });

  it('fall of wickets and partnerships', () => {
    const s = new Sim().start().ball(1).ball(2).out('bowled').newBatter('a3').four();
    expect(s.inn.fallOfWickets).toEqual([{ wicket: 1, runs: 3, batter: 'a2', legalBalls: 3 }]);
    expect(s.inn.partnerships[0]).toMatchObject({ wicket: 1, runs: 3, balls: 3, endedBy: 'wicket' });
    expect(s.inn.partnerships[0].contributions).toEqual({ a1: { runs: 1, balls: 1 }, a2: { runs: 2, balls: 2 } });
    expect(s.inn.currentPartnership).toMatchObject({ wicket: 2, runs: 4, batters: ['a3', 'a1'] });
  });
});

describe('retirements', () => {
  it('retired hurt is not a wicket and the batter may return', () => {
    const s = new Sim().start().do('RETIRE', { batterId: 'a1', kind: 'retired_hurt' });
    expect(s.inn.wickets).toBe(0);
    expect(s.inn.striker).toBeNull();
    s.newBatter('a3').out('bowled').newBatter('a1');
    expect(s.batter('a1').status).toBe('batting');
    expect(s.inn.battingOrder).toEqual(['a1', 'a2', 'a3']);
  });

  it('retired out counts as a wicket without bowler credit', () => {
    const s = new Sim().start().do('RETIRE', { batterId: 'a2', kind: 'retired_out' });
    expect(s.inn.wickets).toBe(1);
    expect(s.inn.nonStriker).toBeNull();
    expect(s.bowler('b1').wickets).toBe(0);
  });

  it('only a batter at the crease can retire', () => {
    const s = new Sim().start();
    expectScoringError(() => s.do('RETIRE', { batterId: 'a5', kind: 'retired_hurt' }), E.INVALID_PLAYER);
  });
});

describe('bowling restrictions', () => {
  const longMatch = () => new Sim(makeSetup({ oversPerInnings: 6, maxOversPerBowler: 2 })).start();

  it('bowler must be chosen at the start of each over', () => {
    const s = longMatch().overOfDots();
    expectScoringError(() => s.ball(0), E.BOWLER_REQUIRED);
  });

  it('same bowler cannot bowl consecutive overs', () => {
    const s = longMatch().overOfDots();
    expectScoringError(() => s.setBowler('b1'), E.CONSECUTIVE_OVERS);
    s.setBowler('b2');
    expect(s.inn.bowler).toBe('b2');
  });

  it('maximum overs per bowler is enforced', () => {
    const s = longMatch().overOfDots().overOfDots('b2').overOfDots('b1').overOfDots('b2');
    expect(s.bowler('b1').oversStarted).toBe(2);
    expectScoringError(() => s.setBowler('b1'), E.BOWLER_LIMIT_REACHED);
    const view = toScorerView(s.state, s.setup, meta(s.setup));
    const b1 = view.scorer.bowlers.find((b) => b.id === 'b1');
    expect(b1).toMatchObject({ available: false, overs: '2.0' });
    expect(view.scorer.bowlers.find((b) => b.id === 'b3').available).toBe(true);
    s.setBowler('b3');
  });

  it('limit is configurable', () => {
    const s = new Sim(makeSetup({ oversPerInnings: 6, maxOversPerBowler: 1 })).start().overOfDots().overOfDots('b2');
    expectScoringError(() => s.setBowler('b1'), E.BOWLER_LIMIT_REACHED);
  });

  it('bowler must be in the fielding XI', () => {
    const s = longMatch().overOfDots();
    expectScoringError(() => s.setBowler('a3'), E.INVALID_BOWLER);
  });

  it('a chosen bowler can be corrected before the first ball', () => {
    const s = longMatch().overOfDots().setBowler('b2').setBowler('b3').ball(0);
    expect(s.inn.overs[1].bowlers).toEqual(['b3']);
    expect(s.bowler('b2').oversStarted).toBe(0);
  });

  it('mid-over change needs confirmation; part over counts toward the limit', () => {
    const s = longMatch().dots(3);
    expectScoringError(() => s.setBowler('b2'), E.INVALID_BOWLER);
    s.setBowler('b2', true).dots(3);
    expect(s.inn.overs[0].bowlers).toEqual(['b1', 'b2']);
    expect(s.bowler('b1').legalBalls).toBe(3);
    expect(s.bowler('b2').legalBalls).toBe(3);
    // neither may bowl the next over
    expectScoringError(() => s.setBowler('b1'), E.CONSECUTIVE_OVERS);
    expectScoringError(() => s.setBowler('b2'), E.CONSECUTIVE_OVERS);
    s.overOfDots('b3').overOfDots('b2');
    // b2 started two overs (part + full) → limit reached
    s.overOfDots('b4');
    expectScoringError(() => s.setBowler('b2'), E.BOWLER_LIMIT_REACHED);
    // a split over is never a maiden
    expect(s.bowler('b1').maidens).toBe(0);
  });

  it('replaced bowler cannot come back in the same over', () => {
    const s = longMatch().dots(2).setBowler('b2', true).ball(0);
    expectScoringError(() => s.setBowler('b1', true), E.INVALID_BOWLER);
  });
});

describe('innings completion', () => {
  it('ends when the configured overs are complete', () => {
    const s = new Sim(makeSetup({ oversPerInnings: 2 })).start().overOfDots().overOfDots('b2');
    expect(s.inn.status).toBe('COMPLETED');
    expect(s.inn.endReason).toBe('overs_complete');
    expect(s.state.status).toBe(MATCH_STATE.INNINGS_BREAK);
    expect(s.lastEffects).toEqual(expect.arrayContaining(['OVER_COMPLETED', 'INNINGS_COMPLETED']));
    expectScoringError(() => s.ball(1), E.INNINGS_NOT_IN_PROGRESS);
  });

  it.each([8, 10])('%i-over innings completes after the right number of legal balls', (overs) => {
    const s = new Sim(makeSetup({ oversPerInnings: overs, maxOversPerBowler: 2 })).start();
    for (let o = 0; o < overs; o++) s.overOfDots(o === 0 ? undefined : `b${(o % 5) + 1}`);
    expect(s.inn.legalBalls).toBe(overs * 6);
    expect(s.inn.status).toBe('COMPLETED');
  });

  it('ends when all wickets are lost (XI size − 1)', () => {
    const s = new Sim(makeSetup({ xiSize: 4 })).start().out('bowled').newBatter('a3').out('bowled').newBatter('a4');
    expect(s.inn.status).toBe('IN_PROGRESS');
    s.out('bowled');
    expect(s.inn.status).toBe('COMPLETED');
    expect(s.inn.endReason).toBe('all_out');
    expect(s.inn.wickets).toBe(3);
  });

  it('manual end of innings', () => {
    const s = new Sim().start().ball(4).do('END_INNINGS', { reason: 'declared' });
    expect(s.inn).toMatchObject({ status: 'COMPLETED', endReason: 'declared' });
    expect(s.state.status).toBe(MATCH_STATE.INNINGS_BREAK);
  });

  it('second innings gets target = first innings + 1', () => {
    const s = new Sim().start().four().ball(1).do('END_INNINGS').start2();
    expect(s.inn).toMatchObject({ number: 2, battingTeam: B, bowlingTeam: A, target: 6 });
  });

  it('a third innings cannot be started', () => {
    const s = new Sim().start().do('END_INNINGS').start2().do('END_INNINGS', {});
    expectScoringError(() => s.start('a1', 'a2', 'b1'), E.MATCH_COMPLETED);
  });

  it('openers must be distinct XI players; bowler from fielding XI', () => {
    const s = new Sim();
    expectScoringError(() => s.start('a1', 'a1', 'b1'), E.INVALID_PLAYER);
    expectScoringError(() => s.start('a1', 'b2', 'b1'), E.INVALID_PLAYER);
    expectScoringError(() => s.start('a1', 'a2', 'a3'), E.INVALID_BOWLER);
  });
});

describe('chase and result', () => {
  const firstInnings = (runs) => {
    const s = new Sim();
    s.start();
    for (let i = 0; i < runs; i++) s.ball(1);
    return s.do('END_INNINGS').start2();
  };

  it('target reached ends the match immediately with wickets margin', () => {
    const s = firstInnings(5).four();
    expect(s.state.status).toBe(MATCH_STATE.IN_PROGRESS);
    const live = toLiveView(s.state, s.setup, meta(s.setup));
    expect(live.current).toMatchObject({ target: 6, runsNeeded: 2, ballsRemaining: 11 });
    expect(live.current.rrr).toBeCloseTo(1.09, 2);
    s.ball(2);
    expect(s.state.status).toBe(MATCH_STATE.COMPLETED);
    expect(s.inn.endReason).toBe('target_reached');
    expect(s.state.result).toMatchObject({ type: 'win', winner: B, marginWickets: 10, ballsRemaining: 10 });
    expect(resultText(s.state.result, meta(s.setup))).toBe('Bravo won by 10 wickets (10 balls left)');
    expectScoringError(() => s.ball(1), E.MATCH_COMPLETED);
  });

  it('target reached by extras (wide) also ends the match', () => {
    const s = firstInnings(0).wide();
    expect(s.state.status).toBe(MATCH_STATE.COMPLETED);
  });

  it('defending team wins by runs', () => {
    const s = firstInnings(6).ball(2);
    s.do('END_INNINGS', { reason: 'overs_complete' });
    expect(s.state.result).toMatchObject({ type: 'win', winner: A, marginRuns: 4 });
    expect(resultText(s.state.result, meta(s.setup))).toBe('Alpha won by 4 runs');
  });

  it('chasing team all out short of target', () => {
    const s = new Sim(makeSetup({ xiSize: 3 }));
    s.start().four().do('END_INNINGS').start2('b1', 'b2', 'a1').out('bowled').newBatter('b3').out('bowled');
    expect(s.state.result).toMatchObject({ winner: A, marginRuns: 4 });
  });

  it('tie when scores are level', () => {
    const s = firstInnings(3).ball(3).do('END_INNINGS');
    expect(s.state.result).toEqual({ type: 'tie', winner: null, loser: null });
    expect(resultText(s.state.result, meta(s.setup))).toBe('Match tied');
  });

  it('no result can be declared during a live innings', () => {
    const s = new Sim().start().ball(2).do('CONCLUDE', { resultType: 'no_result' });
    expect(s.state.status).toBe(MATCH_STATE.COMPLETED);
    expect(s.state.result.type).toBe('no_result');
    expect(s.inn.endReason).toBe('match_concluded');
    expectScoringError(() => s.ball(1), E.MATCH_COMPLETED);
  });

  it('walkover before a ball is bowled', () => {
    const s = new Sim().do('CONCLUDE', { resultType: 'walkover', winnerTeamId: B });
    expect(s.state.result).toMatchObject({ type: 'walkover', winner: B, loser: A });
    expectScoringError(() => new Sim().do('CONCLUDE', { resultType: 'walkover', winnerTeamId: 'X' }), E.VALIDATION);
  });

  it('scoring before the innings starts is rejected', () => {
    expectScoringError(() => new Sim().ball(1), E.MATCH_NOT_STARTED);
  });
});

describe('views', () => {
  it('live view is compact and has current batters, bowler and this over', () => {
    const s = new Sim().start().four().ball(1).wide();
    const v = toLiveView(s.state, s.setup, meta(s.setup));
    expect(v.current).toMatchObject({ runs: 6, wickets: 0, overs: '0.2', crr: 18 });
    expect(v.current.striker).toMatchObject({ id: 'a2', name: 'A2', runs: 0 });
    expect(v.current.nonStriker).toMatchObject({ id: 'a1', runs: 5, balls: 2, fours: 1 });
    expect(v.current.bowler).toMatchObject({ id: 'b1', overs: '0.2', runs: 6 });
    expect(v.current.thisOver.balls).toEqual(['4', '1', 'Wd']);
    expect(v.version).toBe(4);
    expect(JSON.stringify(v).length).toBeLessThan(4000);
  });

  it('this over shows the completed over until the next bowler is chosen', () => {
    const s = new Sim(makeSetup({ oversPerInnings: 3 })).start().dots(5).ball(1);
    let v = toLiveView(s.state, s.setup, meta(s.setup));
    expect(v.current.thisOver).toMatchObject({ over: 1, completed: true });
    expect(v.needs.bowler).toBe(true);
    s.setBowler('b2');
    v = toLiveView(s.state, s.setup, meta(s.setup));
    expect(v.current.thisOver).toMatchObject({ over: 2, balls: [] });
    expect(v.current.recentOvers).toHaveLength(1);
  });

  it('scorecard has dismissal text, did-not-bat, FOW, partnerships and over totals', () => {
    const s = new Sim().start().ball(1).out('caught', { fielderId: 'b3' }).newBatter('a3').four();
    const sc = toScorecard(s.state, s.setup, meta(s.setup)).innings[0];
    expect(sc.batting.map((b) => [b.id, b.dismissal])).toEqual([['a1', 'not out'], ['a2', 'c B3 b B1'], ['a3', 'not out']]);
    expect(sc.didNotBat).toHaveLength(8);
    expect(sc.fallOfWickets[0]).toMatchObject({ wicket: 1, runs: 1, name: 'A2', overs: '0.2' });
    expect(sc.partnerships).toHaveLength(2);
    expect(sc.overs).toBe('0.3');
    expect(sc.overByOver[0]).toMatchObject({ runs: 5, total: 5, balls: ['1', 'W', '4'] });
    expect(sc.bowling[0]).toMatchObject({ id: 'b1', overs: '0.3', runs: 5, wickets: 1 });
  });
});

describe('player stats extraction', () => {
  it('produces rows for every XI player with batting, bowling and fielding', () => {
    const s = new Sim().start().four().out('caught', { fielderId: 'b7' }).newBatter('a3').do('END_INNINGS')
      .start2('b1', 'b2', 'a5').six();
    const rows = extractPlayerStats(s.state, s.setup);
    expect(rows).toHaveLength(22);
    const by = Object.fromEntries(rows.map((r) => [r.playerId, r]));
    expect(by.a1.batting).toMatchObject({ runs: 4, balls: 2, fours: 1, out: true, dismissal: 'caught' });
    expect(by.a3.batting).toMatchObject({ runs: 0, balls: 0, out: false });
    expect(by.a4.batting).toBeNull();
    expect(by.b1.bowling).toMatchObject({ legalBalls: 2, runs: 4, wickets: 1 });
    expect(by.b1.batting).toMatchObject({ runs: 6, sixes: 1 });
    expect(by.b7.fielding.catches).toBe(1);
    expect(by.a5.bowling).toMatchObject({ runs: 6, sixesConceded: 1 });
  });
});

describe('replay', () => {
  it('rebuilds identical state from the event log', () => {
    new Sim().start().four().wide(1).noball(2).out('run_out', { runs: 1, batterId: 'a1' }).newBatter('a3')
      .bye(2).dots(3).setBowler('b2').ball(3).assertReplayable();
  });
});
