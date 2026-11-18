// Phase 6: Tournament Centre — overview totals, records with ties, team records, category isolation.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { best, teamRecords } from '../../src/services/centre.js';
import { auth, bootServer, finishActiveMatches, scorer, seedMatch, sleep } from './harness.js';

describe('team records (pure)', () => {
  const info = (id) => ({ id, name: id });
  const inn = (team, runs, wickets, legalBalls, maxBalls = 60, allOut = false) => ({ team, runs, wickets, legalBalls, maxBalls, allOut, overs: `${Math.floor(legalBalls / 6)}.${legalBalls % 6}` });
  const m = (n, a, b, innings, result) => ({ id: `m${n}`, number: n, teamA: a, teamB: b, summary: { innings }, result });
  const matches = [
    m(1, 'X', 'Y', [inn('X', 120, 5, 60), inn('Y', 80, 10, 50, 60, true)], { type: 'win', winner: 'X', marginRuns: 40 }),
    m(2, 'X', 'Z', [inn('Z', 140, 6, 60), inn('X', 141, 3, 55)], { type: 'win', winner: 'X', marginWickets: 7, ballsRemaining: 5 }),
    m(3, 'Y', 'Z', [inn('Y', 100, 4, 60), inn('Z', 100, 9, 60)], { type: 'tie' }),
    m(4, 'X', 'Y', [inn('Y', 90, 8, 60), inn('X', 91, 3, 40)], { type: 'win', winner: 'X', marginWickets: 7, ballsRemaining: 20 }),
    m(5, 'X', 'Z', [], { type: 'no_result' }),
  ];
  const r = teamRecords(matches, info);

  it('highest / lowest totals, highest chase and biggest margins', () => {
    expect(r.highestTotal.map((t) => [t.team.id, t.runs])).toEqual([['X', 141]]);
    expect(r.lowestTotal.map((t) => [t.team.id, t.runs])).toEqual([['Y', 80]]); // all out: a completed innings
    expect(r.highestChase.map((c) => [c.winner.id, c.runs, c.target])).toEqual([['X', 141, 141]]);
    expect(r.biggestWinByRuns.map((w) => w.runs)).toEqual([40]);
    // two 7-wicket wins: the one with more balls to spare is bigger
    expect(r.biggestWinByWickets.map((w) => [w.matchNumber, w.ballsRemaining])).toEqual([[4, 20]]);
  });

  it('longest winning streak: a no result ends it', () => {
    expect(r.longestWinningStreak).toEqual([{ team: info('X'), wins: 3, current: 0 }]);
  });

  it('best() returns every holder of a shared record', () => {
    expect(best([{ v: 3 }, { v: 5 }, { v: 5 }], (x) => x.v)).toHaveLength(2);
    expect(best([], (x) => x.v)).toEqual([]);
  });
});

describe('Tournament Centre through the API', () => {
  let ctx;
  let m1;
  beforeAll(async () => {
    ctx = await bootServer();
    await finishActiveMatches();
    const confirm = (id) => ctx.http.post(`/api/matches/${id}/confirm-result`).set(auth(ctx.scorerToken)).send({}).expect(200);
    // Match 1: A 6/0 (a four, a single, a wide), B 0/0 → A win by 6 runs.
    m1 = await seedMatch(ctx, { overs: 1, maxOversPerBowler: 1 });
    const [A, B] = [m1.A.players, m1.B.players];
    let s = scorer(ctx, m1.id);
    await s.start(A[0], A[1], B[0]);
    await s.ball(4, { boundary: true }); await s.ball(1); await s.ball(0, { extra: 'wide' });
    for (let i = 0; i < 4; i++) await s.ball(0);
    await s.start(B[0], B[1], A[0]);
    for (let i = 0; i < 6; i++) await s.ball(0);
    await confirm(m1.id);
    // Match 2: A 6/0 (a six), B 8/0 in two balls → B win by 10 wickets.
    const m2 = await seedMatch(ctx, { overs: 1, maxOversPerBowler: 1, teams: [m1.A, m1.B] });
    s = scorer(ctx, m2.id);
    await s.start(A[0], A[1], B[0]);
    await s.ball(6, { boundary: true });
    for (let i = 0; i < 5; i++) await s.ball(0);
    await s.start(B[0], B[1], A[0]);
    await s.ball(4, { boundary: true }); await s.ball(4, { boundary: true });
    await confirm(m2.id);
    // An unplayed Ladies fixture.
    await seedMatch(ctx, { overs: 1, category: 'ladies' });
    await sleep(400); // statistics rebuild after confirmation
  });
  afterAll(async () => { await ctx?.close(); });

  it('overview totals are exact', async () => {
    const c = (await ctx.http.get('/api/tournament-centre?category=mens').expect(200)).body;
    expect(c.category.key).toBe('mens');
    expect(c.overview).toEqual({ totalMatches: 2, completed: 2, remaining: 0, runs: 20, wickets: 0, fours: 3, sixes: 1, extras: 1, overs: '3.2', fifties: 0 });
  });

  it('records and team records, with every holder of a shared record', async () => {
    const c = (await ctx.http.get('/api/tournament-centre?category=mens').expect(200)).body;
    const id = (x) => x.team?.id || x.winner?.id;
    expect(c.teamRecords.highestTotal.map((t) => [id(t), t.runs])).toEqual([[m1.B.id, 8]]);
    expect(c.teamRecords.lowestTotal.map((t) => t.runs)).toEqual([0]);
    expect(c.teamRecords.highestChase.map((t) => [id(t), t.runs, t.target])).toEqual([[m1.B.id, 8, 7]]);
    expect(c.teamRecords.biggestWinByRuns.map((w) => [id(w), w.runs])).toEqual([[m1.A.id, 6]]);
    expect(c.teamRecords.biggestWinByWickets.map((w) => [id(w), w.wickets])).toEqual([[m1.B.id, 10]]);
    expect(c.teamRecords.longestWinningStreak.map(id).sort()).toEqual([m1.A.id, m1.B.id].sort()); // 1 each
    expect(c.teamRecords.mostWins).toHaveLength(2);
    expect(c.records.highestIndividualScore.map((r) => r.runs)).toEqual([8]); // B Player 1: two fours
    expect(c.records.mostSixes[0]).toMatchObject({ playerId: m1.A.players[0] });
    expect(c.records.mostValuablePlayer.length).toBeGreaterThan(0);
    expect(c.leaderboards.orangeCap.holders).toHaveLength(1);
    expect(c.leaderboards.mvp.length).toBeLessThanOrEqual(5);
  });

  it('each category sees only its own matches', async () => {
    const c = (await ctx.http.get('/api/tournament-centre?category=ladies').expect(200)).body;
    expect(c.overview).toMatchObject({ totalMatches: 1, completed: 0, remaining: 1, runs: 0, fours: 0, extras: 0 });
    expect(c.teamRecords.highestTotal).toEqual([]);
    expect(c.records.highestIndividualScore).toEqual([]);
  });
});
