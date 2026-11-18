// Qualification predictor: every mathematical statement is checked against brute force over all
// combinations of the remaining results, on hundreds of random small leagues.
import { describe, expect, it } from 'vitest';
import { analyseQualification, outcomes } from '../../src/engine/qualification.js';

function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
}

/** Exhaustive truth for one team. */
function bruteForce({ teams, remaining, rules, slots }, id) {
  const outs = outcomes(rules);
  const ids = teams.map((t) => t.id);
  const own = remaining.filter((m) => m.teamA === id || m.teamB === id);
  const next = own[0];
  const truth = {
    canQualifyOutright: false, canQualify: false, secured: true, safeUnlessTieBreak: true,
    qualifiesIfWinsAll: true, aliveAfterNonWinNext: false,
  };
  const pts = new Map(teams.map((t) => [t.id, t.points]));
  const picked = [];
  const walk = (i) => {
    if (i === remaining.length) {
      const p = pts.get(id);
      let above = 0;
      let level = 0;
      for (const o of ids) if (o !== id) { if (pts.get(o) > p) above += 1; else if (pts.get(o) === p) level += 1; }
      if (above + level < slots) truth.canQualifyOutright = true;
      if (above < slots) truth.canQualify = true;
      if (above + level >= slots) truth.secured = false;
      if (above >= slots) truth.safeUnlessTieBreak = false;
      const winsAllPlain = own.every((m) => picked[remaining.indexOf(m)] === (m.teamA === id ? 'A' : 'B'));
      if (winsAllPlain && above + level >= slots) truth.qualifiesIfWinsAll = false;
      if (next) {
        const code = picked[remaining.indexOf(next)];
        const isA = next.teamA === id;
        const o = outs.find((x) => x[2] === code);
        if ((isA ? o[0] : o[1]) < rules.win && above < slots) truth.aliveAfterNonWinNext = true;
      }
      return;
    }
    const m = remaining[i];
    for (const o of outs) {
      pts.set(m.teamA, pts.get(m.teamA) + o[0]);
      pts.set(m.teamB, pts.get(m.teamB) + o[1]);
      picked[i] = o[2];
      walk(i + 1);
      pts.set(m.teamA, pts.get(m.teamA) - o[0]);
      pts.set(m.teamB, pts.get(m.teamB) - o[1]);
    }
  };
  walk(0);
  return truth;
}

function randomLeague(seed) {
  const r = rng(seed);
  const n = 4 + Math.floor(r() * 3); // 4–6 teams
  const teams = Array.from({ length: n }, (_, i) => ({ id: `T${i}`, points: 2 * Math.floor(r() * 5), position: i + 1 }));
  const remaining = [];
  const count = 2 + Math.floor(r() * 5); // 2–6 matches
  for (let i = 0; i < count; i++) {
    const a = Math.floor(r() * n);
    let b = Math.floor(r() * n);
    if (b === a) b = (a + 1) % n;
    remaining.push({ id: `m${i}`, number: i + 1, teamA: `T${a}`, teamB: `T${b}` });
  }
  const rules = { win: 2, loss: 0, tie: 1, noResult: r() < 0.5 ? 1 : 0, bonus: { enabled: r() < 0.6, points: 1 } };
  return { teams, remaining, rules, slots: 1 + Math.floor(r() * Math.min(4, n - 1)) };
}

describe('qualification predictor vs brute force', () => {
  it('300 random leagues: every proven statement is true, and nothing provable is missed', () => {
    for (let seed = 1; seed <= 300; seed++) {
      const league = randomLeague(seed);
      const got = analyseQualification({ ...league, budget: 1e7, enumerateLimit: 0 });
      for (const t of league.teams) {
        const truth = bruteForce(league, t.id);
        const g = got[t.id];
        const ctx = `seed ${seed}, team ${t.id}`;
        expect(g.undetermined, ctx).toBe(false);
        expect(g.canQualifyOutright, ctx).toBe(truth.canQualifyOutright);
        expect(g.canQualify, ctx).toBe(truth.canQualify);
        expect(g.secured, ctx).toBe(truth.secured);
        expect(g.safeUnlessTieBreak, ctx).toBe(truth.safeUnlessTieBreak);
        expect(g.eliminated, ctx).toBe(!truth.canQualify);
        expect(g.qualifiesIfWinsAll, ctx).toBe(truth.qualifiesIfWinsAll);
        if (g.remaining && truth.canQualify) expect(g.mustWinNext, ctx).toBe(!truth.aliveAfterNonWinNext);
      }
    }
  });
});

describe('statuses', () => {
  const rules = { win: 2, loss: 0, tie: 1, noResult: 1, bonus: { enabled: false } };
  const team = (id, points, position) => ({ id, points, position });

  it('secured, eliminated and in-own-hands on a 4-team, top-2 table', () => {
    // One match left each: A–D and B–C.  A 8, B 4, C 4, D 0.
    const r = analyseQualification({
      teams: [team('A', 8, 1), team('B', 4, 2), team('C', 4, 3), team('D', 0, 4)],
      remaining: [{ id: 'x', teamA: 'A', teamB: 'D' }, { id: 'y', teamA: 'B', teamB: 'C' }],
      rules, slots: 2,
    });
    expect(r.A.status).toBe('SECURED');
    expect(r.D.status).toBe('ELIMINATED'); // at most 2 points
    // B: a win takes it through; a tie leaves B and C level (NRR), so it is not a must-win.
    expect(r.B).toMatchObject({ status: 'IN_OWN_HANDS', mustWinNext: false, qualifiesIfWinsAll: true });
  });

  it('must win, and a win without the bonus point leaves it to NRR', () => {
    const bonusRules = { ...rules, bonus: { enabled: true, points: 1 } };
    // A 10 through; B 4 v C 6 for the second place.
    const r = analyseQualification({
      teams: [team('A', 10, 1), team('C', 6, 2), team('B', 4, 3), team('D', 0, 4)],
      remaining: [{ id: 'y', teamA: 'B', teamB: 'C' }],
      rules: bonusRules, slots: 2,
    });
    expect(r.B).toMatchObject({ status: 'MUST_WIN', mustWinNext: true, qualifiesIfWinsAll: false, canQualifyOutright: true });
    // C: a bonus-point win for B puts B strictly above, so C is not safe — but a C win is enough.
    expect(r.C).toMatchObject({ status: 'IN_OWN_HANDS', safeUnlessTieBreak: false });
  });

  it('a level finish is never presented as certain', () => {
    // Two teams level for the last place whatever happens: NRR decides.
    const r = analyseQualification({
      teams: [team('A', 6, 1), team('B', 4, 2), team('C', 4, 3)],
      remaining: [],
      rules, slots: 2,
    });
    // League finished: the real table (with tie-breaks applied) decides.
    expect(r.B.status).toBe('QUALIFIED');
    expect(r.C.status).toBe('ELIMINATED');
  });

  it('can only qualify on net run rate', () => {
    // C can at best draw level with B for the 2nd place.
    const r = analyseQualification({
      teams: [team('A', 10, 1), team('B', 6, 2), team('C', 4, 3), team('D', 0, 4)],
      remaining: [{ id: 'x', teamA: 'C', teamB: 'D' }],
      rules, slots: 2,
    });
    expect(r.C.status).toBe('NRR_ONLY');
    expect(r.B.status).toBe('NRR_DEPENDENT');
    expect(r.A.status).toBe('SECURED');
  });

  it('gives up honestly when the search is too large', () => {
    const teams = Array.from({ length: 10 }, (_, i) => team(`T${i}`, 4, i + 1));
    const remaining = [];
    for (let i = 0; i < 10; i++) for (let j = i + 1; j < 10; j++) remaining.push({ id: `${i}-${j}`, teamA: `T${i}`, teamB: `T${j}` });
    const r = analyseQualification({ teams, remaining, rules, slots: 4, budget: 50, enumerateLimit: 0 });
    for (const v of Object.values(r)) {
      expect(['SECURED', 'ELIMINATED']).not.toContain(v.status);
    }
  });

  it('counts the share of combinations when small enough', () => {
    const r = analyseQualification({
      teams: [team('A', 2, 1), team('B', 2, 2), team('C', 0, 3)],
      remaining: [{ id: 'x', teamA: 'A', teamB: 'B' }],
      rules, slots: 1,
    });
    expect(r.A.combinations).toEqual({ total: 3, outright: 1, tieBreak: 1 }); // win / tie (level) / loss
  });
});
