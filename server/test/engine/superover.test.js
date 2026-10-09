import { describe, expect, it } from 'vitest';
import { ERROR_CODES as E } from '@cricket/shared';
import { Sim, makeSetup, meta, expectScoringError, A, B } from './helpers.js';
import { MATCH_STATE, extractPlayerStats, resultText, toLiveView, toScorerView, toSummary } from '../../src/engine/index.js';

/** Both sides score `runs` in the main match (1s, then the innings is ended). */
function tiedMatch(runs = 4, setup = { ...makeSetup(), superOver: true }) {
  const s = new Sim(setup).start();
  for (let i = 0; i < runs; i++) s.ball(1);
  s.do('END_INNINGS').start2();
  for (let i = 0; i < runs; i++) s.ball(1);
  return s.do('END_INNINGS', { reason: 'overs_complete' });
}

describe('super over', () => {
  it('a league tie stays a tie', () => {
    const s = tiedMatch(4, makeSetup());
    expect(s.state.status).toBe(MATCH_STATE.COMPLETED);
    expect(s.state.result).toMatchObject({ type: 'tie' });
  });

  it('a knockout tie goes to a Super Over: side batting second bats first, one over, two wickets', () => {
    const s = tiedMatch();
    expect(s.state.status).toBe(MATCH_STATE.INNINGS_BREAK);
    expect(s.state.result).toBeNull();
    expect(s.lastEffects).toContain('SUPER_OVER');
    const view = toScorerView(s.state, s.setup, meta(s.setup));
    expect(view.superOver).toBe(1);
    expect(view.scorer.battingTeam).toBe(B);
    s.start('b3', 'b4', 'a5');
    expect(s.inn).toMatchObject({ number: 3, superOver: 1, battingTeam: B, maxBalls: 6, maxWickets: 2, target: null });
    expect(toLiveView(s.state, s.setup, meta(s.setup)).current).toMatchObject({ superOver: 1, maxOvers: 1 });
  });

  it('the Super Over is lost by two wickets and won by the chasing side', () => {
    const s = tiedMatch().start('b1', 'b2', 'a1').six().out('bowled').newBatter('b3');
    expect(s.inn.status).toBe('IN_PROGRESS');
    s.out('bowled');
    expect(s.inn).toMatchObject({ status: 'COMPLETED', endReason: 'all_out', runs: 6 });
    s.start('a1', 'a2', 'b1');
    expect(s.inn).toMatchObject({ number: 4, battingTeam: A, target: 7 });
    s.six().four();
    expect(s.state.status).toBe(MATCH_STATE.COMPLETED);
    expect(s.state.result).toMatchObject({ type: 'win', winner: A, loser: B, superOver: true });
    expect(s.state.result.marginRuns).toBeUndefined();
    expect(resultText(s.state.result, meta(s.setup))).toBe('Match tied (Alpha won the Super Over)');
    s.assertReplayable();
  });

  it('the side batting first in the Super Over wins by defending', () => {
    const s = tiedMatch().start('b1', 'b2', 'a1').four().dots(5).start('a1', 'a2', 'b1').ball(1).dots(5);
    expect(s.state.result).toMatchObject({ type: 'win', winner: B, superOver: true });
  });

  it('a tied Super Over is followed by another, with the batting order reversed', () => {
    const s = tiedMatch().start('b1', 'b2', 'a1').ball(1).dots(5).start('a1', 'a2', 'b1').ball(1).dots(5);
    expect(s.state.status).toBe(MATCH_STATE.INNINGS_BREAK);
    expect(toLiveView(s.state, s.setup, meta(s.setup)).superOver).toBe(2);
    s.start('a3', 'a4', 'b2');
    expect(s.inn).toMatchObject({ number: 5, superOver: 2, battingTeam: A });
    s.dots(6).start('b3', 'b4', 'a2').ball(1);
    expect(s.state.result).toMatchObject({ winner: B, superOver: true });
    s.assertReplayable();
  });

  it('Super Over innings never count toward player statistics or the main summary', () => {
    const s = tiedMatch().start('b1', 'b2', 'a1').six().dots(5).start('a1', 'a2', 'b1').dots(6);
    const rows = extractPlayerStats(s.state, s.setup);
    expect(rows.find((r) => r.playerId === 'b1').batting).toMatchObject({ innings: 2, runs: 2 });
    const summary = toSummary(s.state, s.setup, meta(s.setup));
    expect(summary.innings.map((i) => i.runs)).toEqual([4, 4]);
    expect(summary.superOvers.map((i) => [i.team, i.runs, i.superOver])).toEqual([[B, 6, 1], [A, 0, 1]]);
  });

  it('cannot start another innings once the match is decided', () => {
    const s = tiedMatch().start('b1', 'b2', 'a1').six().dots(5).start('a1', 'a2', 'b1').dots(6);
    expectScoringError(() => s.start('b1', 'b2', 'a1'), E.MATCH_COMPLETED);
  });
});
