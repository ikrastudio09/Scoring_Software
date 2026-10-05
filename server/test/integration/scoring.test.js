import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { MatchEvent, Match } from '../../src/models/index.js';
import { invalidateRuntime } from '../../src/services/runtime.js';
import { reconcileMatches } from '../../src/services/scoring.js';
import { startServer } from '../../src/index.js';
import { auth, bootServer, clearCaches, scorer, seedMatch, sleep } from './harness.js';

let ctx;
beforeAll(async () => { ctx = await bootServer(); });
afterAll(async () => { await ctx?.close(); });

describe('authorization', () => {
  it('rejects scoring without a token and with a bad token', async () => {
    const { id } = await seedMatch(ctx);
    await ctx.http.post(`/api/matches/${id}/deliveries`).send({ runs: 1, clientEventId: randomUUID(), expectedVersion: 0 }).expect(401);
    await ctx.http.post(`/api/matches/${id}/deliveries`).set(auth('garbage')).send({ runs: 1, clientEventId: randomUUID(), expectedVersion: 0 }).expect(401);
  });

  it('scorers cannot do admin-only operations', async () => {
    await ctx.http.post('/api/teams').set(auth(ctx.scorerToken)).send({ name: 'X', shortName: 'X' }).expect(403);
    await ctx.http.put('/api/tournament').set(auth(ctx.scorerToken)).send({ name: 'Hack' }).expect(403);
  });

  it('wrong password is rejected; viewer endpoints are public', async () => {
    await ctx.http.post('/api/auth/login').send({ username: 'admin', password: 'nope' }).expect(401);
    await ctx.http.get('/api/home').expect(200);
    await ctx.http.get('/api/points-table').expect(200);
  });

  it('rejects arbitrary state mutation fields', async () => {
    const { id } = await seedMatch(ctx);
    const res = await ctx.http.post(`/api/matches/${id}/deliveries`).set(auth(ctx.scorerToken))
      .send({ runs: 1, score: 87, wickets: 4, clientEventId: randomUUID(), expectedVersion: 0 }).expect(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('full match through the API', () => {
  it('scores a match from setup to confirmed result, points table and statistics', async () => {
    const { id, A, B } = await seedMatch(ctx, { overs: 2, maxOversPerBowler: 1 });
    const s = scorer(ctx, id);
    const [a1, a2, a3] = A.players;
    const [b1, b2, b3] = B.players;

    await s.start(a1, a2, b1);
    expect(s.last.match.status).toBe('LIVE');
    await s.ball(4, { boundary: true });
    await s.ball(1);
    await s.ball(0, { extra: 'wide' });
    await s.ball(0, { wicket: { type: 'caught', fielderId: b3 } }); // a2 caught
    expect(s.last.needs.batter).toBe(true);
    await s.batter(a3);
    await s.ball(6, { boundary: true });
    await s.ball(0);
    await s.ball(0); // 6th legal ball (the wide did not count)
    expect(s.last.needs.bowler).toBe(true);
    // b1 has bowled his 1 allowed over and the previous over
    const res = await s.send('bowler', { bowlerId: b1 }, { expect: 422 });
    expect(res.body.error.code).toBe('CONSECUTIVE_OVERS');
    await s.over(b2, [1, 1, 0, 0, 2, 0]);
    expect(s.last.state).toBe('INNINGS_BREAK');
    expect(s.last.innings[0]).toMatchObject({ runs: 16, wickets: 1, overs: '2.0' });
    expect(s.last.match.status).toBe('INNINGS_BREAK');

    // second innings: chase 17
    await s.start(b1, b2, a1);
    expect(s.last.current.target).toBe(17);
    await s.over(null, [6, 6, 4, 0, 0, 0]);
    await s.bowler(a2);
    await s.ball(1);
    expect(s.last.state).toBe('COMPLETED');
    expect(s.last.result.text).toMatch(/won by 10 wickets \(5 balls left\)/);
    expect(s.last.match.status).toBe('COMPLETED');
    // scoring a completed match is rejected
    const after = await s.send('deliveries', { runs: 1 }, { expect: 422 });
    expect(after.body.error.code).toBe('MATCH_COMPLETED');

    // not in points table until confirmed
    let table = (await ctx.http.get('/api/points-table').expect(200)).body;
    let rowB = table.groups[0].rows.find((r) => r.team.id === B.id);
    expect(rowB.played).toBe(0);

    const suggestion = (await ctx.http.get(`/api/matches/${id}/player-of-match-suggestion`).set(auth(ctx.scorerToken))).body.suggestion;
    expect(suggestion.playerId).toBeTruthy();
    await ctx.http.post(`/api/matches/${id}/confirm-result`).set(auth(ctx.scorerToken)).send({ playerOfMatch: b1 }).expect(200);
    await sleep(300); // derived data rebuilds asynchronously

    table = (await ctx.http.get('/api/points-table').expect(200)).body;
    rowB = table.groups[0].rows.find((r) => r.team.id === B.id);
    const rowA = table.groups[0].rows.find((r) => r.team.id === A.id);
    expect(rowB).toMatchObject({ played: 1, won: 1, points: 2, position: 1 });
    expect(rowA).toMatchObject({ played: 1, lost: 1, points: 0 });
    // NRR: B 17 in 1.1 overs (7 balls) vs 16 in 2 overs; A the inverse
    expect(rowB.nrr).toBeCloseTo(17 / (7 / 6) - 16 / 2, 3);
    expect(rowA.nrr).toBeCloseTo(16 / 2 - 17 / (7 / 6), 3);

    const lb = (await ctx.http.get('/api/stats/leaderboards').expect(200)).body;
    expect(lb.mostRuns[0]).toMatchObject({ playerId: b1, name: 'B Player 1' });
    expect(lb.mostRuns[0].batting.runs).toBe(16);
    expect(lb.mostSixes[0].batting.sixes).toBe(2);
    expect(lb.mostWickets[0]).toMatchObject({ playerId: b1 });

    const profile = (await ctx.http.get(`/api/players/${b1}`).expect(200)).body.player;
    expect(profile.career.playerOfMatch).toBe(1);
    expect(profile.matches).toHaveLength(1);

    // confirmed match is locked against scoring, including undo
    const locked = await s.undo({ expect: 409 });
    expect(locked.body.error.code).toBe('MATCH_LOCKED');
    // only admins can reopen; reopening removes it from the table
    await ctx.http.post(`/api/matches/${id}/reopen`).set(auth(ctx.scorerToken)).send({ reason: 'fix' }).expect(403);
    await ctx.http.post(`/api/matches/${id}/reopen`).set(auth(ctx.adminToken)).send({ reason: 'scoring correction' }).expect(200);
    await sleep(300);
    table = (await ctx.http.get('/api/points-table').expect(200)).body;
    expect(table.groups[0].rows.find((r) => r.team.id === B.id).played).toBe(0);
    // after reopening, undo works again and the match goes back to live
    await s.undo();
    expect(s.last.match.status).toBe('SECOND_INNINGS');
    expect(s.last.result).toBeNull();

    // scorecard is complete
    const sc = (await ctx.http.get(`/api/matches/${id}/scorecard`).expect(200)).body.scorecard;
    expect(sc.innings[0].batting.find((b) => b.id === a2).dismissal).toBe('c B Player 3 b B Player 1');
    expect(sc.innings[0].extras).toMatchObject({ wides: 1, total: 1 });
  });

  it('chasing side falling short: defending team wins by runs', async () => {
    const { id, A, B } = await seedMatch(ctx, { overs: 1, maxOversPerBowler: 1 });
    const s = scorer(ctx, id);
    await s.start(A.players[0], A.players[1], B.players[0]);
    await s.over(null, [4, 0, 0, 0, 0, 1]);
    await s.start(B.players[0], B.players[1], A.players[0]);
    await s.over(null, [1, 0, 0, 0, 0, 0]);
    expect(s.last.result).toMatchObject({ type: 'win', winner: A.id, marginRuns: 4 });
    expect(s.last.result.text).toMatch(/won by 4 runs/);
  });
});

describe('duplicate and concurrent commands', () => {
  it('the same clientEventId twice records one ball', async () => {
    const { id, A, B } = await seedMatch(ctx);
    const s = scorer(ctx, id);
    await s.start(A.players[0], A.players[1], B.players[0]);
    const key = randomUUID();
    const first = await s.send('deliveries', { runs: 1 }, { clientEventId: key, expectedVersion: 1 });
    const retry = await s.send('deliveries', { runs: 1 }, { clientEventId: key, expectedVersion: 1 });
    expect(first.body.duplicate).toBe(false);
    expect(retry.body.duplicate).toBe(true);
    expect(retry.body.view.current.runs).toBe(1);
    expect(await MatchEvent.countDocuments({ match: id, type: 'DELIVERY' })).toBe(1);
  });

  it('20 parallel retries of one request record exactly one ball', async () => {
    const { id, A, B } = await seedMatch(ctx);
    const s = scorer(ctx, id);
    await s.start(A.players[0], A.players[1], B.players[0]);
    const key = randomUUID();
    const results = await Promise.all(Array.from({ length: 20 }, () => ctx.http.post(`/api/matches/${id}/deliveries`)
      .set(auth(ctx.scorerToken)).send({ runs: 4, boundary: true, clientEventId: key, expectedVersion: 1 })));
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(results.filter((r) => !r.body.duplicate)).toHaveLength(1);
    expect(await MatchEvent.countDocuments({ match: id, type: 'DELIVERY' })).toBe(1);
    const live = (await ctx.http.get(`/api/matches/${id}/live`)).body.live;
    expect(live.current.runs).toBe(4);
  });

  it('a double tap (two different requests on the same version) records one ball', async () => {
    const { id, A, B } = await seedMatch(ctx);
    const s = scorer(ctx, id);
    await s.start(A.players[0], A.players[1], B.players[0]);
    const tap = () => ctx.http.post(`/api/matches/${id}/deliveries`).set(auth(ctx.scorerToken))
      .send({ runs: 1, clientEventId: randomUUID(), expectedVersion: 1 });
    const [r1, r2] = await Promise.all([tap(), tap()]);
    expect([r1.status, r2.status].sort()).toEqual([200, 409]);
    const conflict = r1.status === 409 ? r1 : r2;
    expect(conflict.body.error.code).toBe('STALE_STATE');
    expect(conflict.body.error.details.currentVersion).toBe(2);
    expect(conflict.body.error.details.view.current.runs).toBe(1);
    expect(await MatchEvent.countDocuments({ match: id, type: 'DELIVERY' })).toBe(1);
  });

  it('a double-tapped undo reverts only one event', async () => {
    const { id, A, B } = await seedMatch(ctx);
    const s = scorer(ctx, id);
    await s.start(A.players[0], A.players[1], B.players[0]);
    await s.ball(1);
    await s.ball(2);
    const v = s.version;
    const undo = () => ctx.http.post(`/api/matches/${id}/undo`).set(auth(ctx.scorerToken)).send({ clientEventId: randomUUID(), expectedVersion: v });
    const [u1, u2] = await Promise.all([undo(), undo()]);
    expect([u1.status, u2.status].sort()).toEqual([200, 409]);
    const live = (await ctx.http.get(`/api/matches/${id}/live`)).body.live;
    expect(live.current.runs).toBe(1);
  });
});

describe('undo', () => {
  it('restores the full previous state and keeps an auditable log', async () => {
    const { id, A, B } = await seedMatch(ctx);
    const s = scorer(ctx, id);
    const [a1, a2, a3] = A.players;
    await s.start(a1, a2, B.players[0]);
    await s.ball(1);
    const before = (await ctx.http.get(`/api/matches/${id}/scorer`).set(auth(ctx.scorerToken))).body.view;
    await s.ball(0, { wicket: { type: 'bowled' } });
    await s.batter(a3);
    await s.undo(); // undo new batter
    await s.undo(); // undo wicket
    const after = s.last;
    expect(after.current).toEqual(before.current);
    expect(after.scorer).toEqual(before.scorer);
    expect(after.version).toBe(6);
    expect(after.lastEvent).toMatchObject({ type: 'UNDO' });

    const events = (await ctx.http.get(`/api/matches/${id}/events`).set(auth(ctx.scorerToken))).body.events;
    expect(events.map((e) => [e.seq, e.type, e.undone])).toEqual([
      [1, 'START_INNINGS', false], [2, 'DELIVERY', false], [3, 'DELIVERY', true], [4, 'NEW_BATTER', true], [5, 'UNDO', false], [6, 'UNDO', false],
    ]);
    expect(events[4]).toMatchObject({ undoesSeq: 4, user: { username: 'scorer' } });
    expect(events[2].context).toMatchObject({ innings: 1, over: '0.1', score: '1/0' });

    // undo everything, then nothing left
    await s.undo();
    await s.undo();
    const none = await s.undo({ expect: 409 });
    expect(none.body.error.code).toBe('NOTHING_TO_UNDO');
    expect(s.last.match.status).toBe('READY');
  });

  it('undo after the match-winning ball reopens the chase', async () => {
    const { id, A, B } = await seedMatch(ctx, { overs: 1, maxOversPerBowler: 1 });
    const s = scorer(ctx, id);
    await s.start(A.players[0], A.players[1], B.players[0]);
    await s.over(null, [1, 0, 0, 0, 0, 0]);
    await s.start(B.players[0], B.players[1], A.players[0]);
    await s.ball(4, { boundary: true });
    expect(s.last.match.status).toBe('COMPLETED');
    await s.undo();
    expect(s.last.match.status).toBe('SECOND_INNINGS');
    expect(s.last.result).toBeNull();
    const m = await Match.findById(id).lean();
    expect(m.status).toBe('SECOND_INNINGS');
    expect(m.result.type).toBeNull();
  });
});

describe('validation errors are meaningful', () => {
  it('returns domain error codes', async () => {
    const { id, A, B } = await seedMatch(ctx);
    const s = scorer(ctx, id);
    let r = await s.send('deliveries', { runs: 1 }, { expect: 422 });
    expect(r.body.error.code).toBe('MATCH_NOT_STARTED');
    r = await s.send('innings/start', { strikerId: A.players[0], nonStrikerId: A.players[0], bowlerId: B.players[0] }, { expect: 422 });
    expect(r.body.error.code).toBe('INVALID_PLAYER');
    r = await s.send('innings/start', { strikerId: A.players[0], nonStrikerId: A.players[1], bowlerId: A.players[2] }, { expect: 422 });
    expect(r.body.error.code).toBe('INVALID_BOWLER');
    await s.start(A.players[0], A.players[1], B.players[0]);
    r = await s.send('deliveries', { runs: 0, extra: 'wide', wicket: { type: 'bowled' } }, { expect: 422 });
    expect(r.body.error).toMatchObject({ code: 'INVALID_WICKET', message: 'Bowled is not possible off a wide' });
    r = await s.send('deliveries', { runs: 9 }, { expect: 400 });
    expect(r.body.error.code).toBe('VALIDATION_ERROR');
    r = await ctx.http.get('/api/matches/000000000000000000000000/live').expect(404);
    expect(r.body.error.code).toBe('NOT_FOUND');
    expect(JSON.stringify(r.body)).not.toMatch(/at .*\.js/); // no stack traces
  });

  it('setup is locked once scoring starts; scoring needs setup', async () => {
    const { id, A, B } = await seedMatch(ctx);
    const s = scorer(ctx, id);
    await s.start(A.players[0], A.players[1], B.players[0]);
    const r = await ctx.http.post(`/api/matches/${id}/setup`).set(auth(ctx.adminToken)).send({
      toss: { winner: A.id, decision: 'bowl' }, playingXI: { teamA: A.players, teamB: B.players },
    }).expect(409);
    expect(r.body.error.code).toBe('INVALID_TRANSITION');

    const bare = (await ctx.http.post('/api/matches').set(auth(ctx.adminToken)).send({ teamA: A.id, teamB: B.id }).expect(201)).body.match;
    const r2 = await scorer(ctx, bare.id).send('innings/start', { strikerId: A.players[0], nonStrikerId: A.players[1], bowlerId: B.players[0] }, { expect: 409 });
    expect(r2.body.error.code).toBe('MATCH_NOT_STARTED');
  });

  it('XI players must belong to the team', async () => {
    const { A, B } = await seedMatch(ctx);
    const m = (await ctx.http.post('/api/matches').set(auth(ctx.adminToken)).send({ teamA: A.id, teamB: B.id }).expect(201)).body.match;
    const r = await ctx.http.post(`/api/matches/${m.id}/setup`).set(auth(ctx.adminToken)).send({
      toss: { winner: A.id, decision: 'bat' }, playingXI: { teamA: [A.players[0], B.players[0]], teamB: B.players.slice(1, 3) },
    }).expect(400);
    expect(r.body.error.message).toMatch(/belong to that team/);
  });
});

describe('recovery', () => {
  it('scorer refresh: full state is recovered from the server (cache dropped)', async () => {
    const { id, A, B } = await seedMatch(ctx, { overs: 3, maxOversPerBowler: 2 });
    const s = scorer(ctx, id);
    await s.start(A.players[0], A.players[1], B.players[0]);
    await s.over(null, [1, 2, 0, 4, 0, 1]);
    await s.bowler(B.players[1]);
    await s.ball(0, { wicket: { type: 'lbw' } });
    await s.batter(A.players[2]);
    await s.ball(3);
    const before = s.last;
    invalidateRuntime(); // as if the process restarted: rebuild from the event log
    const after = (await ctx.http.get(`/api/matches/${id}/scorer`).set(auth(ctx.scorerToken)).expect(200)).body.view;
    expect(after).toEqual(before);
    expect(after.current).toMatchObject({ runs: 11, wickets: 1, overs: '1.2' });
  });

  it('server restart: a new process recovers identical state from MongoDB', async () => {
    const { id, A, B } = await seedMatch(ctx, { overs: 3, maxOversPerBowler: 2 });
    const s = scorer(ctx, id);
    await s.start(A.players[0], A.players[1], B.players[0]);
    await s.over(null, [6, 0, 1, 0, 0, 2]);
    await s.bowler(B.players[1]);
    await s.ball(1, { extra: 'noball' });
    await s.ball(0, { extra: 'wide' });
    const before = s.last;

    clearCaches();
    const second = await startServer({ port: 0, mongoUri: ctx.uri }); // shares the mongoose connection
    const req = (await import('supertest')).default(`http://127.0.0.1:${second.port}`);
    const after = (await req.get(`/api/matches/${id}/scorer`).set(auth(ctx.scorerToken)).expect(200)).body.view;
    expect(after).toEqual(before);
    expect(after.current.freeHit).toBe(true);
    // continue scoring on the new process with the same version
    const next = await req.post(`/api/matches/${id}/deliveries`).set(auth(ctx.scorerToken))
      .send({ runs: 2, clientEventId: randomUUID(), expectedVersion: before.version }).expect(200);
    expect(next.body.view.current.runs).toBe(14); // 9 + (nb+1) 2 + wide 1 + 2
    second.io.close();
    await new Promise((r) => second.server.close(r));
    clearCaches();
  });

  it('a stale match document is repaired from the event log', async () => {
    const { id, A, B } = await seedMatch(ctx);
    const s = scorer(ctx, id);
    await s.start(A.players[0], A.players[1], B.players[0]);
    await s.ball(4, { boundary: true });
    // simulate a crash between the event insert and the match-document sync
    await Match.updateOne({ _id: id }, { $set: { stateVersion: 1, summary: null, status: 'READY' } });
    clearCaches();
    const out = await reconcileMatches();
    expect(out.repaired).toBeGreaterThanOrEqual(1);
    const m = await Match.findById(id).lean();
    expect(m).toMatchObject({ stateVersion: 2, status: 'LIVE' });
    expect(m.summary.innings[0].runs).toBe(4);
  });
});

describe('match lifecycle', () => {
  it('enforces status transitions and handles abandonment / no result', async () => {
    const { id, A, B } = await seedMatch(ctx);
    const admin = auth(ctx.adminToken);
    await ctx.http.post(`/api/matches/${id}/status`).set(admin).send({ status: 'POSTPONED' }).expect(200);
    // postponed matches cannot be scored
    const r = await scorer(ctx, id).send('innings/start', { strikerId: A.players[0], nonStrikerId: A.players[1], bowlerId: B.players[0] }, { expect: 409 });
    expect(r.body.error.code).toBe('INVALID_TRANSITION');
    await ctx.http.post(`/api/matches/${id}/status`).set(admin).send({ status: 'ABANDONED' }).expect(409); // postponed → abandoned not allowed
    await ctx.http.post(`/api/matches/${id}/status`).set(admin).send({ status: 'SCHEDULED' }).expect(200);
    await ctx.http.post(`/api/matches/${id}/status`).set(admin).send({ status: 'ABANDONED', note: 'rain' }).expect(200);
    const m = (await ctx.http.get(`/api/matches/${id}`)).body.match;
    expect(m.status).toBe('ABANDONED');
    expect(m.result).toMatchObject({ type: 'abandoned', confirmed: true });

    // in-play: conclude as no result
    const g = await seedMatch(ctx, { teams: [A, B] });
    const s = scorer(ctx, g.id);
    await s.start(A.players[0], A.players[1], B.players[0]);
    await s.ball(2);
    await ctx.http.post(`/api/matches/${g.id}/status`).set(admin).send({ status: 'ABANDONED' }).expect(409);
    await s.send('conclude', { resultType: 'no_result' });
    expect(s.last.match.status).toBe('COMPLETED');
    expect(s.last.result.text).toBe('No result');
    await ctx.http.post(`/api/matches/${g.id}/confirm-result`).set(auth(ctx.scorerToken)).send({}).expect(200);
    await sleep(300);
    const table = (await ctx.http.get('/api/points-table')).body;
    const row = table.groups[0].rows.find((x) => x.team.id === A.id);
    expect(row.noResult).toBeGreaterThanOrEqual(2);
  });

  it('fixtures with scoring cannot be deleted', async () => {
    const { id, A, B } = await seedMatch(ctx);
    await scorer(ctx, id).start(A.players[0], A.players[1], B.players[0]);
    await ctx.http.delete(`/api/matches/${id}`).set(auth(ctx.adminToken)).expect(409);
  });
});
