// Phase 8 (pure): the career rule against double counting, and historical import validation.
import { describe, expect, it } from 'vitest';
import { resolveCareer } from '../../src/services/history.js';
import { guessMapping, validateHistory } from '../../src/services/historyImport.js';

const perf = (season, runs, extra = {}) => ({ season, perf: { seasons: 1, matches: 5, runs, ...extra } });

describe('resolveCareer: every season counted once', () => {
  const current = perf(21, 100);
  const auctionPrev = { season: 20, perf: { seasons: 1, matches: 10, runs: 41 } };
  const auctionTotal = { toSeason: 19, perf: { seasons: 3, matches: 30, runs: 300 } };

  it('auction aggregates alone: current + previous year + overall', () => {
    const r = resolveCareer({ current, previousYear: auctionPrev, overall: auctionTotal });
    expect(r.totals).toMatchObject({ seasons: 5, matches: 45, runs: 441 });
    expect(r.parts.map((p) => p.source)).toEqual(['scored', 'auction', 'auction-total']);
  });

  it('an imported row for the previous season replaces the auction figure', () => {
    const r = resolveCareer({ current, imported: [perf(20, 50)], previousYear: auctionPrev, overall: auctionTotal });
    expect(r.totals.runs).toBe(100 + 50 + 300);
    expect(r.notes[0]).toMatch(/Season 20 is counted from its season record/);
  });

  it('season rows covering every season of the auction total replace the total', () => {
    const r = resolveCareer({ current, imported: [perf(17, 90), perf(18, 100), perf(19, 110)], overall: auctionTotal });
    expect(r.totals).toMatchObject({ seasons: 4, runs: 400 });
    expect(r.parts.map((p) => p.source)).not.toContain('auction-total');
  });

  it('season rows covering only part of the total: the total is used, the rows are not added again', () => {
    const r = resolveCareer({ current, imported: [perf(18, 100)], overall: auctionTotal });
    expect(r.totals).toMatchObject({ seasons: 4, runs: 400 }); // 100 + 300, not 100 + 300 + 100
    expect(r.parts.map((p) => p.season ?? p.toSeason)).toEqual([21, 19]);
    expect(r.notes[0]).toMatch(/cover only part of the auction total/);
  });

  it('a season scored in this system beats an imported row for the same season', () => {
    const r = resolveCareer({ current, scored: [perf(20, 70)], imported: [perf(20, 999)] });
    expect(r.totals.runs).toBe(170);
  });

  it('nothing at all: no career', () => {
    expect(resolveCareer({}).totals).toBeNull();
  });
});

describe('historical import validation', () => {
  const base = { kind: 'players', category: 'mens', currentSeason: 21 };
  const map = (rows) => guessMapping('players', Object.keys(rows[0]));

  it('recognises common column names and converts overs to balls', () => {
    const rows = [{ Player: 'A Kumar', Season: '19', Team: 'Lions', M: '6', R: '120', W: '4', Overs: '10.3', Ct: '2', SR: '130.5' }];
    const r = validateHistory({ ...base, rows, mapping: map(rows) });
    expect(r.ok).toBe(true);
    expect(r.rows[0]).toMatchObject({ name: 'A Kumar', season: 19, categoryKey: 'mens', teamName: 'Lions' });
    expect(r.rows[0].performance).toMatchObject({ seasons: 1, matches: 6, runs: 120, wickets: 4, ballsBowled: 63, catches: 2, supplied: { strikeRate: 130.5 } });
  });

  it('maps years to seasons and refuses seasons scored in this system', () => {
    const rows = [{ Name: 'X', Year: '2024', Runs: '5' }, { Name: 'Y', Year: '2026', Runs: '5' }];
    const r = validateHistory({ ...base, rows, mapping: map(rows), seasonFromYear: { year: 2026, season: 21 } });
    expect(r.rows.map((x) => x.season)).toEqual([19]);
    expect(r.errors[0].message).toMatch(/season 21 is scored in this system/);
  });

  it('flags the same person twice in one season, unless a key column tells them apart', () => {
    const rows = [{ Name: 'Amit Shah', Season: '10', Runs: '5' }, { Name: 'AMIT  SHAH', Season: '10', Runs: '9' }];
    expect(validateHistory({ ...base, rows, mapping: map(rows) }).errors[0].message).toMatch(/appears twice for season 10/);
    const keyed = rows.map((x, i) => ({ ...x, Key: `p${i}` }));
    const r = validateHistory({ ...base, rows: keyed, mapping: map(keyed) });
    expect(r.ok).toBe(true);
    expect(r.groups).toHaveLength(2);
  });

  it('category column values must be mapped; bad numbers are reported with their row', () => {
    const rows = [{ Name: 'A', Season: '5', Category: 'Gents', Runs: '10' }, { Name: 'B', Season: '5', Category: 'Women', Runs: '-3' }];
    const r = validateHistory({ ...base, category: undefined, rows, mapping: map(rows), categoryValues: { Gents: 'mens' } });
    expect(r.rows.map((x) => [x.name, x.categoryKey])).toEqual([['A', 'mens']]);
    expect(r.errors.map((e) => e.row)).toEqual([3]);
  });

  it('team seasons: one champion per season, results within matches', () => {
    const rows = [
      { Team: 'Lions', Season: '19', P: '6', W: '5', L: '1', Champion: 'yes' },
      { Team: 'Tigers', Season: '19', P: '6', W: '4', L: '3', Champion: 'yes' },
    ];
    const r = validateHistory({ kind: 'teams', category: 'mens', currentSeason: 21, rows, mapping: guessMapping('teams', Object.keys(rows[0])) });
    const msgs = r.errors.map((e) => e.message).join(' | ');
    expect(msgs).toMatch(/add up to more than 6 matches/);
    expect(r.rows[0]).toMatchObject({ champion: true, finalist: true, won: 5 });
  });
});
