// Historical aggregates: parsing the auction "Previous Statistics" text (real rows from the
// MPL-2025 player list), the previous-year / overall-previous split, and career combination.
import { describe, expect, it } from 'vitest';
import {
  combinePerformances, derivePreviousPerformance, parsePreviousStatistics, performanceRates, totalsOf,
} from '@cricket/shared';

const derive = (text) => derivePreviousPerformance(parsePreviousStatistics(text));
const codes = (r) => r.flags.map((f) => f.code);

describe('parsePreviousStatistics', () => {
  it('reads the all-seasons and previous-season segments', () => {
    const p = parsePreviousStatistics('ASD:- S-10, M-63, R-380, W-57, C-18, MOM-10 | 2024:- M-10, R-41, W-4, C-3');
    expect(p.error).toBeNull();
    expect(p.segments).toEqual([
      { label: 'ASD', kind: 'all', values: { seasons: 10, matches: 63, runs: 380, wickets: 57, catches: 18, playerOfMatch: 10 }, unknown: [] },
      { label: '2024', kind: 'year', values: { matches: 10, runs: 41, wickets: 4, catches: 3 }, unknown: [] },
    ]);
  });

  it('treats N/A, NULL and blanks as no record', () => {
    for (const t of ['N/A', 'NULL', '', null, undefined, ' - ']) expect(parsePreviousStatistics(t)).toMatchObject({ empty: true, error: null });
  });

  it('reports unreadable text instead of guessing', () => {
    expect(parsePreviousStatistics('ASD S10 M63').error).toMatch(/Cannot read/);
    expect(parsePreviousStatistics('ASD:- S-10, M-sixty').error).toMatch(/Cannot read "M-sixty"/);
  });
});

describe('derivePreviousPerformance (ASD includes the previous year)', () => {
  it('overall previous = ASD − previous year, field by field', () => {
    // #1 KISHAN BAJAJ
    const r = derive('ASD:- S-10, M-63, R-380, W-57, C-18, MOM-10 | 2024:- M-10, R-41, W-4, C-3');
    expect(totalsOf(r.previousYear)).toEqual({ seasons: 1, matches: 10, runs: 41, wickets: 4, catches: 3 });
    expect(totalsOf(r.overallPrevious)).toEqual({ seasons: 9, matches: 53, runs: 339, wickets: 53, catches: 15 });
    // ASD MOM (10) equals 2024 matches (10): the known shifted column — dropped and flagged
    expect(codes(r)).toContain('HISTORY_MOM_UNRELIABLE');
    expect(r.overallPrevious.playerOfMatch).toBeUndefined();
    expect(r.previousYear.meta.label).toBe('2024');
  });

  it('a player whose only season was last year has no overall-previous record', () => {
    // #34 SAMARTH BALDAWA: ASD equals 2024
    const r = derive('ASD:- S-1, M-7, R-26, W-7, C-2, MOM-7 | 2024:- M-7, R-26, W-7, C-2, MOM-1');
    expect(totalsOf(r.previousYear)).toEqual({ seasons: 1, matches: 7, runs: 26, wickets: 7, catches: 2, playerOfMatch: 1 });
    expect(r.overallPrevious).toBeNull();
  });

  it('a player who missed last season: everything is overall previous', () => {
    // #3 DHAWAL MALU (previous team NULL)
    const r = derive('ASD:- S-5, M-11, R-0, W-6, C-2');
    expect(r.previousYear).toBeNull();
    expect(totalsOf(r.overallPrevious)).toEqual({ seasons: 5, matches: 11, runs: 0, wickets: 6, catches: 2 });
    expect(r.flags).toEqual([]);
  });

  it('new players have neither record', () => {
    expect(derive('N/A')).toEqual({ previousYear: null, overallPrevious: null, flags: [] });
  });

  it('never produces negative totals: inconsistent fields are dropped and flagged', () => {
    const r = derive('ASD:- S-3, M-5, R-10 | 2024:- M-6, R-4');
    expect(r.overallPrevious.matches).toBeUndefined();
    expect(r.overallPrevious.runs).toBe(6);
    expect(codes(r)).toContain('HISTORY_INCONSISTENT');
  });

  it('a field given for all seasons but not for the previous year cannot be separated', () => {
    const r = derive('ASD:- S-3, M-12, R-50, C-4 | 2024:- M-4, R-20');
    expect(r.overallPrevious).toMatchObject({ seasons: 2, matches: 8, runs: 30 });
    expect(r.overallPrevious.catches).toBeUndefined();
    expect(codes(r)).toContain('HISTORY_NOT_SEPARABLE');
  });

  it('flags unknown codes and only-previous-year input', () => {
    const r = derive('2024:- M-4, R-20, XYZ-3');
    expect(codes(r)).toEqual(['HISTORY_UNKNOWN_CODE', 'HISTORY_NO_TOTAL']);
    expect(r.overallPrevious).toBeNull();
  });
});

describe('career combination', () => {
  it('sums only the fields every part has, and reports the partial ones', () => {
    const overall = { seasons: 9, matches: 53, runs: 339, wickets: 53, catches: 15 };
    const prevYear = { seasons: 1, matches: 10, runs: 41, wickets: 4, catches: 3 };
    const current = { seasons: 1, matches: 4, runs: 60, ballsFaced: 45, wickets: 2, catches: 1 };
    const { totals, partial } = combinePerformances([overall, prevYear, current]);
    expect(totals).toEqual({ seasons: 11, matches: 67, runs: 440, wickets: 59, catches: 19 });
    expect(partial).toEqual(['ballsFaced']); // only the current season has balls faced
    // missing parts (did not play) are skipped
    expect(combinePerformances([null, prevYear]).totals).toEqual(prevYear);
    expect(combinePerformances([null, null]).totals).toBeNull();
  });

  it('derives rates only from totals with real denominators (never averages of averages)', () => {
    expect(performanceRates({ runs: 340, innings: 12, notOuts: 2, ballsFaced: 250, wickets: 10, ballsBowled: 120, runsConceded: 150 })).toEqual({
      battingAvg: 34, strikeRate: 136, economy: 7.5, bowlingAvg: 15,
    });
    // the auction history has no balls / innings / not outs → no rates
    expect(performanceRates({ matches: 53, runs: 339, wickets: 53 })).toEqual({ battingAvg: null, strikeRate: null, economy: null, bowlingAvg: null });
  });
});
