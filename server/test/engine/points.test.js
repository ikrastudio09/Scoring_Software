import { describe, expect, it } from 'vitest';
import { computeTable } from '../../src/services/points.js';

const teams = ['A', 'B', 'C'].map((id) => ({ id, name: `Team ${id}` }));
const rules = { win: 2, loss: 0, tie: 1, noResult: 1, nrrAllOutUsesFullQuota: true };
const inn = (team, runs, wickets, legalBalls, maxBalls = 60, allOut = false) => ({ team, runs, wickets, legalBalls, maxBalls, allOut });
const match = (teamA, teamB, result, innings) => ({ teamA, teamB, result, summary: { innings }, ballsPerOver: 6 });

describe('points table', () => {
  it('awards configurable points and orders by points then NRR', () => {
    const rows = computeTable(teams, [
      match('A', 'B', { type: 'win', winner: 'A' }, [inn('A', 100, 5, 60), inn('B', 80, 9, 60)]),
      match('B', 'C', { type: 'tie' }, [inn('B', 90, 4, 60), inn('C', 90, 7, 60)]),
      match('A', 'C', { type: 'no_result' }, [inn('A', 30, 1, 24)]),
    ], rules);
    expect(rows.map((r) => [r.team.id, r.played, r.won, r.lost, r.tied, r.noResult, r.points])).toEqual([
      ['A', 2, 1, 0, 0, 1, 3],
      ['C', 2, 0, 0, 1, 1, 2],
      ['B', 2, 0, 1, 1, 0, 1],
    ]);
    expect(rows[0].position).toBe(1);
    expect(rows[0].form).toEqual(['W', 'N']);
  });

  it('computes NRR exactly, excluding no-result matches', () => {
    const [a] = computeTable(teams, [
      match('A', 'B', { type: 'win', winner: 'A' }, [inn('A', 100, 5, 60), inn('B', 80, 9, 60)]),
      match('A', 'C', { type: 'no_result' }, [inn('A', 30, 1, 24)]),
    ], rules);
    expect(a.nrr).toBeCloseTo(100 / 10 - 80 / 10, 3);
    expect(a.runsFor).toBe(100);
  });

  it('uses partial overs for a successful chase (9.4 overs = 58 balls)', () => {
    const rows = computeTable(teams, [
      match('A', 'B', { type: 'win', winner: 'B' }, [inn('A', 120, 6, 60), inn('B', 121, 3, 58)]),
    ], rules);
    const b = rows.find((r) => r.team.id === 'B');
    expect(b.nrr).toBeCloseTo(121 / (58 / 6) - 120 / 10, 3);
  });

  it('charges a bowled-out side the full quota of overs (configurable)', () => {
    const ms = [match('A', 'B', { type: 'win', winner: 'A' }, [inn('A', 100, 5, 60), inn('B', 50, 10, 30, 60, true)])];
    const full = computeTable(teams, ms, rules).find((r) => r.team.id === 'B');
    expect(full.nrr).toBeCloseTo(50 / 10 - 100 / 10, 3);
    const actual = computeTable(teams, ms, { ...rules, nrrAllOutUsesFullQuota: false }).find((r) => r.team.id === 'B');
    expect(actual.nrr).toBeCloseTo(50 / 5 - 100 / 10, 3);
  });

  it('walkover gives points but no NRR', () => {
    const [a] = computeTable(teams, [match('A', 'B', { type: 'walkover', winner: 'A' }, [])], rules);
    expect(a).toMatchObject({ won: 1, points: 2, nrr: 0 });
  });

  it('respects custom points rules', () => {
    const [a] = computeTable(teams, [match('A', 'B', { type: 'win', winner: 'A' }, [inn('A', 1, 0, 6), inn('B', 0, 0, 60)])], { ...rules, win: 4 });
    expect(a.points).toBe(4);
  });

  describe('bonus point', () => {
    const withBonus = { ...rules, bonus: { enabled: true, points: 1, runsPercent: 75, oversPercent: 75 } };
    const eight = (team, runs, legalBalls) => inn(team, runs, 3, legalBalls, 48);

    it('adds a point for restricting the chase below 75% of the target', () => {
      const rows = computeTable(teams, [match('A', 'B', { type: 'win', winner: 'A' }, [eight('A', 59, 48), eight('B', 44, 48)])], withBonus);
      expect(rows[0]).toMatchObject({ team: { id: 'A' }, won: 1, bonus: 1, points: 3 });
      const close = computeTable(teams, [match('A', 'B', { type: 'win', winner: 'A' }, [eight('A', 59, 48), eight('B', 45, 48)])], withBonus);
      expect(close[0]).toMatchObject({ bonus: 0, points: 2 });
    });

    it('adds a point for chasing within 75% of the overs', () => {
      const rows = computeTable(teams, [match('A', 'B', { type: 'win', winner: 'B' }, [eight('A', 59, 48), eight('B', 60, 36)])], withBonus);
      expect(rows[0]).toMatchObject({ team: { id: 'B' }, bonus: 1, points: 3 });
      const slow = computeTable(teams, [match('A', 'B', { type: 'win', winner: 'B' }, [eight('A', 59, 48), eight('B', 60, 37)])], withBonus);
      expect(slow[0]).toMatchObject({ bonus: 0, points: 2 });
    });

    it('never for a Super Over win; NRR uses the main innings only', () => {
      const m = match('A', 'B', { type: 'win', winner: 'A', superOver: true }, [eight('A', 59, 48), eight('B', 59, 48)]);
      const [a] = computeTable(teams, [m], withBonus);
      expect(a).toMatchObject({ team: { id: 'A' }, bonus: 0, points: 2, nrr: 0 });
    });
  });
});

describe('points table tie-breakers', () => {
  const four = ['A', 'B', 'C', 'D'].map((id) => ({ id, name: `Team ${id}` }));
  const won = (w, l) => match(w, l, { type: 'win', winner: w }, [inn(w, 100, 5, 60), inn(l, 99, 5, 60)]);

  it('applies the configured order; head-to-head separates teams level on points', () => {
    // A and B both finish on 4 points with identical NRR; A beat B.
    const games = [won('A', 'B'), won('B', 'C'), won('B', 'D'), won('A', 'C'), won('D', 'A'), won('C', 'D')];
    const h2hFirst = computeTable(four, games, { ...rules, tiebreakers: ['headToHead', 'nrr'] });
    expect(h2hFirst.slice(0, 2).map((r) => r.team.id)).toEqual(['A', 'B']);
    expect(h2hFirst[0].points).toBe(h2hFirst[1].points);
    // wins-first with equal wins falls through to head-to-head as well
    const winsFirst = computeTable(four, games, { ...rules, tiebreakers: ['wins', 'headToHead'] });
    expect(winsFirst.slice(0, 2).map((r) => r.team.id)).toEqual(['A', 'B']);
  });

  it('defaults to NRR, then wins, then head-to-head, then name', () => {
    const rows = computeTable(teams, [], rules);
    expect(rows.map((r) => r.team.id)).toEqual(['A', 'B', 'C']);
  });
});
