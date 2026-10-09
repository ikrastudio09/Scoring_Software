// One-active-match rule, GET /api/live, commentary feed + edits, match/tournament MVP and the
// auction import workflow — through the real HTTP API and Socket.IO.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Match, Player, Team } from '../../src/models/index.js';
import { auth, bootServer, finishActiveMatches, scorer, seedMatch, socketClient, sleep } from './harness.js';

let ctx;
beforeAll(async () => { ctx = await bootServer(); });
afterAll(async () => { await ctx?.close(); });

const admin = () => auth(ctx.adminToken);

describe('one active match', () => {
  it('rejects starting a second match while one is live, then allows it after completion', async () => {
    const m1 = await seedMatch(ctx, { overs: 1, maxOversPerBowler: 1 });
    // seed the second fixture without closing the first
    const m2 = await createReadyMatch(m1);

    const s1 = scorer(ctx, m1.id);
    await s1.start(m1.A.players[0], m1.A.players[1], m1.B.players[0]);
    const live = (await ctx.http.get('/api/live').expect(200)).body;
    expect(live).toMatchObject({ live: true, inPlay: true, matchId: m1.id, version: 1 });

    const s2 = scorer(ctx, m2.id);
    const rejected = await s2.start(m2.A.players[0], m2.A.players[1], m2.B.players[0]).catch((e) => e);
    expect(rejected.message).toMatch(/409.*ANOTHER_MATCH_ACTIVE.*currently live/);
    expect((await Match.findById(m2.id).lean()).status).toBe('READY'); // nothing recorded

    // finish match 1 on the field: still the active match until the result is confirmed
    await s1.over(null, [1, 1, 1, 1, 1, 1]);
    await s1.start(m1.B.players[0], m1.B.players[1], m1.A.players[0]);
    await s1.over(null, [0, 0, 0, 0, 0, 0]);
    expect((await ctx.http.get('/api/live').expect(200)).body).toMatchObject({ live: true, inPlay: false, matchId: m1.id });
    const pending = await s2.start(m2.A.players[0], m2.A.players[1], m2.B.players[0]).catch((e) => e);
    expect(pending.message).toMatch(/ANOTHER_MATCH_ACTIVE.*not confirmed/);

    await ctx.http.post(`/api/matches/${m1.id}/confirm-result`).set(auth(ctx.scorerToken)).send({}).expect(200);
    expect((await ctx.http.get('/api/live').expect(200)).body).toEqual({ live: false });
    await s2.start(m2.A.players[0], m2.A.players[1], m2.B.players[0]);
    expect((await ctx.http.get('/api/live').expect(200)).body.matchId).toBe(m2.id);

    // an admin reopening match 1 for a correction cannot bring it back into play while match 2 is live
    await ctx.http.post(`/api/matches/${m1.id}/reopen`).set(admin()).send({ reason: 'scorer correction' }).expect(200);
    const undo = await scorer(ctx, m1.id, ctx.adminToken);
    undo.version = (await Match.findById(m1.id).lean()).stateVersion;
    const blocked = await undo.undo().catch((e) => e);
    expect(blocked.message).toMatch(/ANOTHER_MATCH_ACTIVE/);
  });

  it('two simultaneous start requests for different matches: exactly one wins', async () => {
    const m1 = await seedMatch(ctx);
    const m2 = await createReadyMatch(m1);
    const results = await Promise.allSettled([
      scorer(ctx, m1.id).start(m1.A.players[0], m1.A.players[1], m1.B.players[0]),
      scorer(ctx, m2.id).start(m2.A.players[0], m2.A.players[1], m2.B.players[0]),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await Match.countDocuments({ status: { $in: ['LIVE', 'INNINGS_BREAK', 'SECOND_INNINGS'] } })).toBe(1);
  });
});

describe('live endpoint, commentary and MVP', () => {
  it('a viewer joining mid-over gets state + recent commentary, then every ball', async () => {
    const { id, A, B } = await seedMatch(ctx, { overs: 2, maxOversPerBowler: 1 });
    const s = scorer(ctx, id);
    await s.start(A.players[0], A.players[1], B.players[0]);
    await s.ball(1);
    await s.ball(4, { boundary: true, shot: 'pull' });
    await s.ball(0);

    const live = (await ctx.http.get('/api/live').expect(200)).body;
    expect(live.view.current).toMatchObject({ runs: 5, wickets: 0, overs: '0.3' });
    expect(live.view.current.thisOver.balls).toEqual(['1', '4', '0']);
    expect(live.commentary.map((c) => c.over)).toEqual(['0.3', '0.2', '0.1']);
    expect(live.commentary[1].text).toBe('B Player 1 to A Player 2, FOUR! Pulled to the boundary.');
    expect(JSON.stringify(live)).not.toMatch(/passwordHash|playerPhone/);

    const viewer = socketClient(ctx, { matchId: id, channel: 'viewer' });
    await viewer.connected();
    await viewer.subscribe();
    await viewer.waitFor((e) => e.type === 'MATCH_STATE_UPDATED' && e.version === live.version);
    await s.ball(2);
    const next = await viewer.waitFor((e) => e.version === live.version + 1);
    expect(next.ball).toMatchObject({ over: '0.4', runs: 2, score: '7/0' });

    // paging back through the commentary
    const page = (await ctx.http.get(`/api/matches/${id}/commentary?limit=2&before=${next.version}`).expect(200)).body;
    expect(page.entries.map((e) => e.over)).toEqual(['0.3', '0.2']);
    viewer.close();
  });

  it('scorer can edit commentary; it is broadcast and never changes the score', async () => {
    const { id, A, B } = await seedMatch(ctx);
    const s = scorer(ctx, id);
    await s.start(A.players[0], A.players[1], B.players[0]);
    await s.ball(4, { boundary: true });
    const seq = s.version;
    const viewer = socketClient(ctx, { matchId: id, channel: 'viewer' });
    await viewer.connected();
    await viewer.subscribe();

    await ctx.http.put(`/api/matches/${id}/commentary/${seq}`).send({ text: 'Nope' }).expect(401);
    await ctx.http.put(`/api/matches/${id}/commentary/999`).set(auth(ctx.scorerToken)).send({ text: 'x' }).expect(404);
    const res = await ctx.http.put(`/api/matches/${id}/commentary/${seq}`).set(auth(ctx.scorerToken))
      .send({ text: 'Beautiful cover drive! Finds the gap.' }).expect(200);
    expect(res.body.entry).toMatchObject({ seq, text: 'Beautiful cover drive! Finds the gap.', edited: true, score: '4/0' });
    const pushed = await viewer.waitFor((e) => e.type === 'COMMENTARY_UPDATED');
    expect(pushed).toMatchObject({ matchId: id, version: seq, entry: { seq, edited: true } });

    const live = (await ctx.http.get(`/api/matches/${id}/live`).expect(200)).body.live;
    expect(live.version).toBe(seq); // no scoring event was created
    expect(live.current.runs).toBe(4);
    // survives a cache drop (stored separately from the scoring log)
    const { invalidateRuntime } = await import('../../src/services/runtime.js');
    invalidateRuntime(id);
    const feed = (await ctx.http.get(`/api/matches/${id}/commentary`).expect(200)).body;
    expect(feed.entries[0].text).toBe('Beautiful cover drive! Finds the gap.');
    // clearing restores the generated sentence
    await ctx.http.put(`/api/matches/${id}/commentary/${seq}`).set(auth(ctx.scorerToken)).send({ text: '' }).expect(200);
    expect((await ctx.http.get(`/api/matches/${id}/commentary`).expect(200)).body.entries[0].edited).toBe(false);
    viewer.close();
  });

  it('match MVP top 5 with reasons; tournament MVP + value-for-money; team and player profiles', async () => {
    const m = await seedMatch(ctx, { overs: 1, maxOversPerBowler: 1 });
    await Player.updateMany({ team: m.A.id }, { $set: { auction: { soldPoints: 200000, status: 'sold' } } });
    const s = scorer(ctx, m.id);
    await s.start(m.A.players[0], m.A.players[1], m.B.players[0]);
    await s.over(null, [6, 4, 1, 0, 0, 1]);
    await s.start(m.B.players[0], m.B.players[1], m.A.players[10]);
    await s.ball(0, { wicket: { type: 'caught', fielderId: m.A.players[3] } });
    await s.batter(m.B.players[2]);
    await s.over(null, [1, 0, 0, 0, 0]);

    const mvp = (await ctx.http.get(`/api/matches/${m.id}/mvp`).expect(200)).body;
    expect(mvp.final).toBe(true);
    expect(mvp.players).toHaveLength(5);
    expect(mvp.players.map((p) => p.rank)).toEqual([1, 2, 3, 4, 5]);
    expect(mvp.players[0].impact.reasons.length).toBeGreaterThan(0);
    for (let i = 1; i < 5; i++) expect(mvp.players[i - 1].impact.total).toBeGreaterThanOrEqual(mvp.players[i].impact.total);
    const sugg = (await ctx.http.get(`/api/matches/${m.id}/player-of-match-suggestion`).set(auth(ctx.scorerToken)).expect(200)).body.suggestion;
    expect(sugg.playerId).toBe(mvp.players[0].playerId);

    await ctx.http.post(`/api/matches/${m.id}/confirm-result`).set(auth(ctx.scorerToken)).send({ playerOfMatch: sugg.playerId }).expect(200);
    await sleep(300);
    const table = (await ctx.http.get('/api/stats/mvp').expect(200)).body;
    const top = table.players[0];
    expect(top).toMatchObject({ rank: 1, matches: 1, mvpAwards: 1 });
    expect(table.players.find((p) => p.playerId === mvp.players[0].playerId).rank).toBe(1);
    expect(table.weights.bowling.wicket).toBe(20);
    // value for money is a separate list; it never changes the MVP order
    expect(table.valueMinMatches).toBe(2);
    expect(table.players.filter((p) => p.soldPoints === 200000).every((p) => p.valuePer100k === Math.round((p.impact.total / 2) * 100) / 100)).toBe(true);

    const team = (await ctx.http.get(`/api/teams/${m.A.id}`).expect(200)).body.team;
    expect(team.record).toMatchObject({ played: 1, won: 1, points: 3, averageScore: 12, position: expect.any(Number) });
    expect(team.record.recent[0]).toMatchObject({ outcome: 'W' });
    expect(team.stats.batting).toMatchObject({ runs: 12, fours: 1, sixes: 1 });
    expect(team.stats.fielding.catches).toBe(1);

    const player = (await ctx.http.get(`/api/players/${m.A.players[0]}`).expect(200)).body.player;
    expect(player.career.batting).toMatchObject({ runs: 11, balls: 3, dots: 0, boundaryPct: 66.7 });
    expect(player.career.impact.total).toBeGreaterThan(0);
    expect(player.auction).toEqual({ soldPoints: 200000, playerPool: null, status: 'sold' });

    // weights are configurable and apply without a rebuild
    await ctx.http.put('/api/tournament').set(admin()).send({ impactWeights: { batting: { run: 3 } } }).expect(200);
    const reweighted = (await ctx.http.get('/api/stats/mvp').expect(200)).body;
    expect(reweighted.weights.batting.run).toBe(3);
    await ctx.http.put('/api/tournament').set(admin()).send({ impactWeights: null }).expect(200);
  });
});

describe('auction import', () => {
  const exportData = () => ({
    players: [
      { playerID: 1024, playerName: 'Rahul Patil', Age: 27, playerType: 'All Rounder', playerPhone: '9876543210', playerPhoto: { url: 'https://img.example/1024.jpg', public_id: 'abc' }, playingStyle: ['Right Arm Batting', 'Right Arm Balling'], soldPoints: 450000, playerStatus: 'sold', playerPool: 2 },
      { playerID: 1025, playerName: 'Jitendra Rao', Age: 30, playerType: 'Bowler', playerPhone: '9876500000', playerPhoto: { url: 'https://img.example/1025.jpg', public_id: 'def' }, playingStyle: ['Left Arm Batting', 'Left Arm Balling'], soldPoints: 300000, playerStatus: 'sold', playerPool: 3 },
      { playerID: 1026, playerName: 'Abdul Danish', Age: 22, playerType: 'Wicket Keeper', playerPhone: '9876511111', playerPhoto: { url: 'https://img.example/1026.jpg', public_id: 'ghi' }, playingStyle: ['Right Arm Batting'], soldPoints: 0, playerStatus: 'unsold', playerPool: 4 },
    ],
    teams: [
      { teamID: 7, teamName: 'SGM Strikers', teamTotalPoints: 8000000, teamPlayers: [{ playerID: 1024, playerName: 'Rahul Patil', soldPoints: 450000, playerPool: 2 }] },
      { teamID: 9, teamName: 'Royal Kings', teamTotalPoints: 8000000, teamPlayers: [{ playerID: 1025, playerName: 'Jitendra Rao', soldPoints: 300000, playerPool: 3 }] },
    ],
  });

  it('validates, previews, imports on confirmation and keeps phone numbers private', async () => {
    await finishActiveMatches();
    await ctx.http.post('/api/admin/import/auction/preview').set(auth(ctx.scorerToken)).send(exportData()).expect(403);

    const preview = (await ctx.http.post('/api/admin/import/auction/preview').set(admin()).send(exportData()).expect(200)).body;
    expect(preview.ok).toBe(true);
    expect(preview.counts).toEqual({ teams: { create: 2 }, players: { create: 2 } });
    expect(preview.teams.map((t) => [t.teamID, t.name, t.players.map((p) => p.playerID)])).toEqual([[7, 'SGM Strikers', [1024]], [9, 'Royal Kings', [1025]]]);
    expect(await Team.countDocuments({ teamID: 7 })).toBe(0); // preview writes nothing

    await ctx.http.post('/api/admin/import/auction/commit').set(admin()).send({ ...exportData(), hash: 'f'.repeat(64) }).expect(409);
    const done = (await ctx.http.post('/api/admin/import/auction/commit').set(admin()).send({ ...exportData(), hash: preview.hash }).expect(200)).body;
    expect(done.result).toEqual({ teams: { create: 2 }, players: { create: 2 } });

    const rahul = await Player.findOne({ playerID: 1024 }).populate('team').lean();
    expect(rahul).toMatchObject({ name: 'Rahul Patil', role: 'allrounder', playerType: 'All Rounder', photoUrl: 'https://img.example/1024.jpg' });
    expect(rahul.team).toMatchObject({ teamID: 7, name: 'SGM Strikers', shortName: 'SGM' });
    expect(rahul.auction).toMatchObject({ soldPoints: 450000, playerPool: 2, status: 'sold' });
    expect(await Player.countDocuments({ playerID: 1026 })).toBe(0); // unsold: no team

    // nothing private is stored or served
    const raw = JSON.stringify(await Player.find({ playerID: { $in: [1024, 1025] } }).lean());
    expect(raw).not.toMatch(/9876543210|9876500000|public_id|Age/);
    const pub = JSON.stringify((await ctx.http.get('/api/players').expect(200)).body);
    expect(pub).not.toMatch(/9876543210|phone/i);
    const prof = (await ctx.http.get(`/api/players/${rahul._id}`).expect(200)).body.player;
    expect(prof).toMatchObject({ playerID: 1024, playingStyle: ['Right Arm Batting', 'Right Arm Balling'], auction: { soldPoints: 450000, status: 'sold' } });

    // re-importing the same file changes nothing
    const again = (await ctx.http.post('/api/admin/import/auction/preview').set(admin()).send(exportData()).expect(200)).body;
    expect(again.counts).toEqual({ teams: { unchanged: 2 }, players: { unchanged: 2 } });
  });

  it('refuses invalid data with a clear report and imports nothing', async () => {
    const data = exportData();
    data.teams[0].teamPlayers.push({ playerID: 1077, playerName: 'Ghost', soldPoints: 1, playerPool: 1 });
    data.players.push({ playerID: 1042, playerName: 'Lonely', playerStatus: 'sold', soldPoints: 1000, playerPool: 1 });
    const before = await Player.countDocuments();
    const preview = (await ctx.http.post('/api/admin/import/auction/preview').set(admin()).send(data).expect(200)).body;
    expect(preview.ok).toBe(false);
    expect(preview.errors.map((e) => [e.ref, e.code])).toEqual(expect.arrayContaining([
      ['Team 7', 'TEAM_PLAYER_UNKNOWN'], ['Player 1042', 'SOLD_WITHOUT_TEAM'],
    ]));
    expect(preview.checks.find((c) => c.label === 'Player-team relationships valid').ok).toBe(false);
    const res = await ctx.http.post('/api/admin/import/auction/commit').set(admin()).send(data).expect(422);
    expect(res.body.error.code).toBe('IMPORT_INVALID');
    expect(await Player.countDocuments()).toBe(before);
  });

  it('links existing teams/players by name and refuses to move a player who has already played', async () => {
    const m = await seedMatch(ctx);
    const teamA = await Team.findById(m.A.id).lean();
    const teamB = await Team.findById(m.B.id).lean();
    const data = {
      players: [
        { playerID: 2001, playerName: 'A Player 1', playerStatus: 'sold', soldPoints: 100000, playerPool: 1 },
        { playerID: 2002, playerName: 'B Player 1', playerStatus: 'sold', soldPoints: 100000, playerPool: 1 },
      ],
      teams: [
        { teamID: 31, teamName: teamA.name, teamPlayers: [{ playerID: 2001 }] },
        { teamID: 32, teamName: teamB.name, teamPlayers: [{ playerID: 2002 }] },
      ],
    };
    const preview = (await ctx.http.post('/api/admin/import/auction/preview').set(admin()).send(data).expect(200)).body;
    expect(preview.ok).toBe(true);
    expect(preview.counts).toEqual({ teams: { link: 2 }, players: { link: 2 } });
    await ctx.http.post('/api/admin/import/auction/commit').set(admin()).send({ ...data, hash: preview.hash }).expect(200);
    expect((await Player.findById(m.A.players[0]).lean()).playerID).toBe(2001);

    // A Player 1 is in a playing XI: moving them to team 32 is refused
    data.teams[0].teamPlayers = [];
    data.teams[1].teamPlayers.push({ playerID: 2001 });
    const bad = (await ctx.http.post('/api/admin/import/auction/preview').set(admin()).send(data).expect(200)).body;
    expect(bad.errors.map((e) => e.code)).toContain('PLAYER_TEAM_LOCKED');
  });
});

/** A second ready fixture between two new teams, without closing any active match. */
async function createReadyMatch(m1) {
  const a = admin();
  const n = Math.random().toString(36).slice(2, 6);
  const A = (await ctx.http.post('/api/teams').set(a).send({ name: `Charlie ${n}`, shortName: 'CHA' }).expect(201)).body.team;
  const B = (await ctx.http.post('/api/teams').set(a).send({ name: `Delta ${n}`, shortName: 'DEL' }).expect(201)).body.team;
  A.players = [];
  B.players = [];
  for (let i = 1; i <= 11; i++) {
    A.players.push((await ctx.http.post('/api/players').set(a).send({ name: `C Player ${i}`, team: A.id }).expect(201)).body.player.id);
    B.players.push((await ctx.http.post('/api/players').set(a).send({ name: `D Player ${i}`, team: B.id }).expect(201)).body.player.id);
  }
  const match = (await ctx.http.post('/api/matches').set(a).send({ teamA: A.id, teamB: B.id }).expect(201)).body.match;
  await ctx.http.post(`/api/matches/${match.id}/setup`).set(a).send({
    toss: { winner: A.id, decision: 'bat' }, playingXI: { teamA: A.players, teamB: B.players },
  }).expect(200);
  return { id: match.id, A, B, m1 };
}
