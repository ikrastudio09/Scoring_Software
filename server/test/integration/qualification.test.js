// Phase 7 through the API: real qualification picture, what-if simulation (never stored), NRR from
// simulated scores, validation.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Match, MatchEvent } from '../../src/models/index.js';
import { auth, bootServer, finishActiveMatches } from './harness.js';

let ctx;
const admin = () => auth(ctx.adminToken);
const teams = [];
const fixtures = new Map(); // "1-2" → match

async function cmd(matchId, path, body, version) {
  const res = await ctx.http.post(`/api/matches/${matchId}/${path}`).set(auth(ctx.scorerToken))
    .send({ clientEventId: randomUUID(), expectedVersion: version, ...body }).expect(200);
  return res.body.version;
}

/** 1-over match, two players a side: the winner scores 1 run, the loser 0. */
async function play(a, b, winnerIsA) {
  const m = fixtures.get(`${a}-${b}`);
  const [A, B] = [teams[a - 1], teams[b - 1]];
  await ctx.http.post(`/api/matches/${m.id}/setup`).set(admin()).send({ toss: { winner: A.id, decision: 'bat' }, playingXI: { teamA: A.players, teamB: B.players } }).expect(200);
  let v = await cmd(m.id, 'innings/start', { strikerId: A.players[0], nonStrikerId: A.players[1], bowlerId: B.players[0] }, 0);
  for (let i = 0; i < 6; i++) v = await cmd(m.id, 'deliveries', { runs: winnerIsA && i === 0 ? 2 : 0 }, v);
  v = await cmd(m.id, 'innings/start', { strikerId: B.players[0], nonStrikerId: B.players[1], bowlerId: A.players[0] }, v);
  if (winnerIsA) for (let i = 0; i < 6; i++) v = await cmd(m.id, 'deliveries', { runs: 0 }, v);
  else v = await cmd(m.id, 'deliveries', { runs: 1 }, v);
  await ctx.http.post(`/api/matches/${m.id}/confirm-result`).set(auth(ctx.scorerToken)).send({}).expect(200);
}

beforeAll(async () => {
  ctx = await bootServer();
  await finishActiveMatches();
  await ctx.http.put('/api/categories/mens').set(admin()).send({
    rules: { oversPerInnings: 1, maxOversPerBowler: 1, playersPerSide: 2 }, points: { bonus: { enabled: false } }, qualification: { slots: 2 },
  }).expect(200);
  for (let i = 1; i <= 4; i++) {
    const t = (await ctx.http.post('/api/teams').set(admin()).send({ name: `Q Team ${i}`, shortName: `Q${i}`, category: 'mens' }).expect(201)).body.team;
    t.players = [];
    for (let j = 1; j <= 2; j++) t.players.push((await ctx.http.post('/api/players').set(admin()).send({ name: `Q${i} P${j}`, team: t.id }).expect(201)).body.player.id);
    teams.push(t);
  }
  for (const [a, b] of [[1, 2], [1, 3], [2, 4], [1, 4], [2, 3], [3, 4]]) {
    fixtures.set(`${a}-${b}`, (await ctx.http.post('/api/matches').set(admin()).send({ teamA: teams[a - 1].id, teamB: teams[b - 1].id, category: 'mens' }).expect(201)).body.match);
  }
  await play(1, 2, true);
  await play(1, 3, true);
  await play(2, 4, true); // Q1 4 pts, Q2 2, Q3 0, Q4 0 — three matches left
}, 60000);
afterAll(async () => { await ctx?.close(); });

const rowsOf = (body) => body.groups.flatMap((g) => g.rows);
const byTeam = (body, n) => rowsOf(body).find((r) => r.team.id === teams[n - 1].id);

describe('qualification picture', () => {
  it('reports every team with a status, label, certainty and explanation', async () => {
    const q = (await ctx.http.get('/api/qualification?category=mens').expect(200)).body;
    expect(q.rules).toMatchObject({ slots: 2, win: 2, bonus: null });
    expect(q.remaining).toHaveLength(3);
    for (const r of rowsOf(q)) {
      expect(r).toMatchObject({ status: expect.any(String), label: expect.any(String), certainty: expect.stringMatching(/guaranteed|nrr|possible/), text: expect.any(String) });
      expect(r.maxPoints).toBeGreaterThanOrEqual(r.points);
    }
    // 3 matches left; without bonus points a tie and a no result score the same, so each match has
    // 3 distinct points outcomes: 27 combinations, small enough to count exactly.
    expect(byTeam(q, 1).combinations.total).toBe(27);
    // Q1 (4 pts, one match left) can still be caught on points: never presented as certain yet.
    expect(byTeam(q, 1).certainty).not.toBe('guaranteed');
  });
});

describe('what-if (hypothetical, never stored)', () => {
  it('simulating every remaining match gives the final table without touching real data', async () => {
    const before = (await ctx.http.get('/api/points-table?category=mens').expect(200)).body;
    const matchDocs = JSON.stringify(await Match.find({}, 'status result stateVersion').sort({ _id: 1 }).lean());
    const events = await MatchEvent.countDocuments();

    const results = [
      { matchId: fixtures.get('1-4').id, outcome: 'A' },
      { matchId: fixtures.get('2-3').id, outcome: 'A' },
      { matchId: fixtures.get('3-4').id, outcome: 'A' },
    ];
    const w = (await ctx.http.post('/api/qualification/what-if').send({ category: 'mens', results }).expect(200)).body;
    expect(w).toMatchObject({ hypothetical: true, simulated: 3 });
    expect(w.groups[0].final).toBe(true);
    expect([1, 2, 3, 4].map((n) => [byTeam(w, n).points, byTeam(w, n).status])).toEqual([
      [6, 'QUALIFIED'], [4, 'QUALIFIED'], [2, 'ELIMINATED'], [0, 'ELIMINATED'],
    ]);
    // Wins entered without scores cannot move NRR: they are listed, not guessed.
    expect(w.nrrExcludes).toHaveLength(3);

    // Nothing real changed.
    expect((await ctx.http.get('/api/points-table?category=mens').expect(200)).body.groups).toEqual(before.groups);
    expect(JSON.stringify(await Match.find({}, 'status result stateVersion').sort({ _id: 1 }).lean())).toBe(matchDocs);
    expect(await MatchEvent.countDocuments()).toBe(events);
  });

  it('a simulated score moves NRR; inconsistent scores are rejected', async () => {
    const id = fixtures.get('1-4').id;
    const scored = {
      matchId: id, outcome: 'A',
      score: { battedFirst: 'teamA', teamA: { runs: 12, wickets: 0, overs: '1.0' }, teamB: { runs: 3, wickets: 1, overs: '0.4' } },
    };
    const plain = (await ctx.http.post('/api/qualification/what-if').send({ category: 'mens', results: [{ matchId: id, outcome: 'A' }] }).expect(200)).body;
    const w = (await ctx.http.post('/api/qualification/what-if').send({ category: 'mens', results: [scored] }).expect(200)).body;
    expect(w.nrrExcludes).toEqual([]);
    expect(byTeam(w, 1).nrr).toBeGreaterThan(byTeam(plain, 1).nrr);
    expect(byTeam(w, 4).nrr).toBeLessThan(byTeam(plain, 4).nrr);

    const bad = (score, outcome = 'A') => ctx.http.post('/api/qualification/what-if').send({ category: 'mens', results: [{ matchId: id, outcome, score }] }).expect(400);
    await bad({ battedFirst: 'teamA', teamA: { runs: 3, wickets: 0, overs: '1.0' }, teamB: { runs: 5, wickets: 0, overs: '0.3' } }); // winner scored less
    await bad({ battedFirst: 'teamA', teamA: { runs: 5, wickets: 0, overs: '1.0' }, teamB: { runs: 5, wickets: 0, overs: '1.0' } }); // level scores are not a win
    await bad({ battedFirst: 'teamA', teamA: { runs: 5, wickets: 0, overs: '2.0' }, teamB: { runs: 1, wickets: 1, overs: '0.2' } }); // too many overs
    await bad({ battedFirst: 'teamA', teamA: { runs: 5, wickets: 0, overs: '1.0' }, teamB: { runs: 1, wickets: 0, overs: '0.3' } }); // chase stopped early
    // only open fixtures; no duplicates
    const played = fixtures.get('1-2').id;
    await ctx.http.post('/api/qualification/what-if').send({ category: 'mens', results: [{ matchId: played, outcome: 'B' }] }).expect(400);
    await ctx.http.post('/api/qualification/what-if').send({ category: 'mens', results: [{ matchId: id, outcome: 'A' }, { matchId: id, outcome: 'B' }] }).expect(400);
  });
});
