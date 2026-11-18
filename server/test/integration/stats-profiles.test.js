// Phase 5: Orange / Purple Cap with ties, fielding leaderboard, configurable eligibility, and the
// player profile's separate history blocks + career total.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { rankRows, playerHistory } from '../../src/services/stats.js';
import { auth, bootServer, finishActiveMatches, scorer, seedMatch, sleep } from './harness.js';

describe('rankRows (competition ranking)', () => {
  const rows = [10, 8, 8, 7, 5, 5, 5, 2].map((v, i) => ({ id: i, v }));
  it('ties share a rank and the next rank skips', () => {
    expect(rankRows(rows, (r) => r.v).map((r) => r.rank)).toEqual([1, 2, 2, 4, 5, 5, 5, 8]);
    expect(rankRows(rows, (r) => r.v).map((r) => r.tied)).toEqual([false, true, true, false, true, true, true, false]);
  });
  it('a cut-off never splits a shared place', () => {
    expect(rankRows(rows, (r) => r.v, 5).map((r) => r.v)).toEqual([10, 8, 8, 7, 5, 5, 5]);
    expect(rankRows(rows, (r) => r.v, 4).map((r) => r.v)).toEqual([10, 8, 8, 7]);
  });
});

describe('playerHistory (profile blocks)', () => {
  const career = {
    matches: 4, playerOfMatch: 1, bpo: 6,
    batting: { innings: 4, runs: 60, balls: 45, notOuts: 1, fours: 5, sixes: 2 },
    bowling: { wickets: 2, legalBalls: 36, runs: 40 },
    fielding: { catches: 1, runOuts: 0, stumpings: 0 },
  };
  const player = {
    history: {
      previousYear: { seasons: 1, matches: 10, runs: 41, wickets: 4, catches: 3, meta: { label: '2024', season: 20 } },
      overallPrevious: { seasons: 9, matches: 53, runs: 339, wickets: 53, catches: 15, meta: { toSeason: 19 } },
    },
  };
  it('keeps the three blocks apart and sums only fields every part has', () => {
    const h = playerHistory(player, career, 21);
    expect(h.currentSeason.label).toBe('Season 21');
    expect(h.previousYear.label).toBe('Season 20 (2024)');
    expect(h.overallPrevious.label).toBe('Before Season 20');
    expect(h.currentSeason.rates).toMatchObject({ battingAvg: 20, strikeRate: 133.33, economy: 6.67 });
    expect(h.previousYear.rates).toEqual({ battingAvg: null, strikeRate: null, economy: null, bowlingAvg: null });
    expect(h.career.totals).toEqual({ seasons: 11, matches: 67, runs: 440, wickets: 59, catches: 19 });
    expect(h.career.partial).toEqual(expect.arrayContaining(['ballsFaced', 'innings', 'fours']));
    expect(h.career.rates.strikeRate).toBeNull(); // no balls faced before this season: never guessed
  });
  it('a new player: only the current season; career equals it', () => {
    const h = playerHistory({}, career, 21);
    expect(h.previousYear).toBeNull();
    expect(h.overallPrevious).toBeNull();
    expect(h.career.totals.runs).toBe(60);
    expect(h.career.rates.strikeRate).toBe(133.33);
  });
});

describe('caps, leaderboards and profiles through the API', () => {
  let ctx;
  let m;
  beforeAll(async () => {
    ctx = await bootServer();
    await finishActiveMatches();
    m = await seedMatch(ctx, { overs: 1, maxOversPerBowler: 1 });
    const [A, B] = [m.A.players, m.B.players];
    const s = scorer(ctx, m.id);
    // Innings 1: A1 and A2 one run each (tied Orange Cap), A1 stumped off B1 (keeper B11).
    await s.start(A[0], A[1], B[0]);
    await s.ball(1);
    await s.ball(1);
    await s.ball(0, { wicket: { type: 'stumped', fielderId: B[10] } });
    await s.batter(A[2]);
    await s.ball(0); await s.ball(0); await s.ball(0);
    // Innings 2: A1 bowls B1 (tied Purple Cap: one wicket each, A1 more economical).
    await s.start(B[0], B[1], A[0]);
    await s.ball(0, { wicket: { type: 'bowled' } });
    await s.batter(B[2]);
    for (let i = 0; i < 5; i++) await s.ball(0);
    await ctx.http.post(`/api/matches/${m.id}/confirm-result`).set(auth(ctx.scorerToken)).send({}).expect(200);
    await sleep(400); // statistics rebuild runs after confirmation
  });
  afterAll(async () => { await ctx?.close(); });

  it('tied leaders are joint cap holders with a shared rank', async () => {
    const lb = (await ctx.http.get('/api/stats/leaderboards?category=mens').expect(200)).body;
    expect(lb.orangeCap.holders.sort()).toEqual([m.A.players[0], m.A.players[1]].sort());
    expect(lb.orangeCap.rows.slice(0, 2).map((r) => [r.rank, r.tied, r.runs])).toEqual([[1, true, 1], [1, true, 1]]);
    expect(lb.orangeCap.rows[0]).toMatchObject({ matches: 1, innings: 1, fours: 0, sixes: 0 });
    expect(lb.orangeCap.rows[0]).toHaveProperty('strikeRate');

    expect(lb.purpleCap.holders.sort()).toEqual([m.A.players[0], m.B.players[0]].sort());
    // same rank; the more economical bowler is listed first
    expect(lb.purpleCap.rows.map((r) => [r.playerId, r.rank, r.economy])).toEqual([[m.A.players[0], 1, 0], [m.B.players[0], 1, 2]]);
    expect(lb.purpleCap.rows[0]).toMatchObject({ wickets: 1, overs: '1.0', best: '1/0' });

    // fielding: the keeper's stumping counts
    expect(lb.mostDismissals[0]).toMatchObject({ playerId: m.B.players[10], fielding: { stumpings: 1 } });
  });

  it('cap eligibility is configurable per category', async () => {
    const admin = auth(ctx.adminToken);
    await ctx.http.put('/api/categories/mens').set(admin).send({ leaderboards: { capMinMatches: 2 } }).expect(200);
    const lb = (await ctx.http.get('/api/stats/leaderboards?category=mens').expect(200)).body;
    expect(lb.orangeCap.rows).toHaveLength(0);
    expect(lb.qualify.capMinMatches).toBe(2);
    await ctx.http.put('/api/categories/mens').set(admin).send({ leaderboards: null }).expect(200);
  });

  it('the profile shows previous year, overall previous and career separately, plus awards', async () => {
    const id = m.A.players[0];
    await ctx.http.put(`/api/admin/players/${id}/history`).set(auth(ctx.adminToken)).send({
      previousYear: { seasons: 1, matches: 10, runs: 41, wickets: 4 }, overallPrevious: { seasons: 9, matches: 53, runs: 339, wickets: 53 }, reason: 'test data',
    }).expect(200);
    const p = (await ctx.http.get(`/api/players/${id}`).expect(200)).body.player;
    expect(p.awards).toMatchObject({ orangeCap: true, orangeRank: 1, purpleCap: true, purpleRank: 1 });
    expect(p.history.currentSeason.totals).toMatchObject({ matches: 1, runs: 1, ballsFaced: 2, wickets: 1 });
    expect(p.history.previousYear.totals).toEqual({ seasons: 1, matches: 10, runs: 41, wickets: 4 });
    expect(p.history.overallPrevious.totals).toEqual({ seasons: 9, matches: 53, runs: 339, wickets: 53 });
    expect(p.history.career.totals).toEqual({ seasons: 11, matches: 64, runs: 381, wickets: 58 });
    expect(JSON.stringify(p)).not.toMatch(/"age"|"raw"|"flags"/);
  });
});
