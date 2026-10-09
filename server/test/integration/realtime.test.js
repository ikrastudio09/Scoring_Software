import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootServer, scorer, seedMatch, socketClient, sleep } from './harness.js';

let ctx;
beforeAll(async () => { ctx = await bootServer(); });
afterAll(async () => { await ctx?.close(); });

const types = (c) => c.received.map((e) => e.type);

describe('realtime fan-out', () => {
  it('LED and viewers receive every ball, in order, with a compact ball summary', async () => {
    const { id, A, B } = await seedMatch(ctx, { overs: 2, maxOversPerBowler: 1 });
    const led = socketClient(ctx, { matchId: id, channel: 'led' });
    const viewer = socketClient(ctx, { matchId: id, channel: 'viewer' });
    await Promise.all([led.connected(), viewer.connected()]);
    expect((await led.subscribe()).ok).toBe(true);
    expect((await viewer.subscribe()).ok).toBe(true);
    // initial snapshot on subscribe
    await led.waitFor((e) => e.type === 'MATCH_STATE_UPDATED');
    await viewer.waitFor((e) => e.type === 'MATCH_STATE_UPDATED');

    const s = scorer(ctx, id);
    await s.start(A.players[0], A.players[1], B.players[0]); // v1 MATCH_STARTED
    await s.ball(1); // v2
    await s.ball(2); // v3
    await s.ball(4, { boundary: true }); // v4
    await s.ball(0, { wicket: { type: 'bowled' } }); // v5 WICKET
    await s.batter(A.players[2]); // v6
    await s.ball(0); // v7
    await s.ball(1); // v8 OVER_COMPLETED

    await led.waitFor((e) => e.version === 8);
    await viewer.waitFor((e) => e.version === 8);
    const versions = (c) => c.received.filter((e) => e.version > 0).map((e) => e.version);
    expect(versions(led)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(versions(viewer)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    const viewerEvents = viewer.received.filter((e) => e.version > 0);
    expect(viewerEvents.map((e) => e.type)).toEqual([
      'MATCH_STARTED', 'BALL_RECORDED', 'BALL_RECORDED', 'BALL_RECORDED', 'WICKET', 'MATCH_STATE_UPDATED', 'BALL_RECORDED', 'OVER_COMPLETED',
    ]);

    // every delivery carries a compact ball summary with local commentary
    const four = viewerEvents.find((e) => e.version === 4);
    expect(four.ball).toMatchObject({ seq: 4, innings: 1, over: '0.3', kind: 'four', label: '4', runs: 4, score: '7/0' });
    expect(four.ball.text).toMatch(/^B Player 1 to A Player 2, FOUR!/) // A2 took strike after the single;
    expect(viewerEvents.find((e) => e.version === 5).ball).toMatchObject({ kind: 'wicket', score: '7/1' });
    expect(viewerEvents.find((e) => e.version === 6).ball).toBeUndefined(); // new batter: not a delivery
    const over = viewerEvents.at(-1);
    expect(over).toMatchObject({ matchId: id, eventId: `${id}:8`, effects: expect.arrayContaining(['OVER_COMPLETED']) });
    expect(over.ball.endOfOver).toMatchObject({ over: 1, runs: 8, wickets: 1 });
    expect(over.live.current).toMatchObject({ runs: 8, wickets: 1, overs: '1.0' });
    expect(typeof over.ts).toBe('number');
    // payloads stay small (no database documents)
    expect(JSON.stringify(over).length).toBeLessThan(6000);

    await s.undo();
    const undo = await viewer.waitFor((e) => e.type === 'EVENT_UNDONE');
    expect(undo.version).toBe(9);
    expect(undo.live.current.overs).toBe('0.5');
    led.close();
    viewer.close();
  });

  it('reconnect recovers the latest state in one message without replaying history', async () => {
    const { id, A, B } = await seedMatch(ctx, { overs: 3, maxOversPerBowler: 2 });
    const led = socketClient(ctx, { matchId: id, channel: 'led' });
    await led.connected();
    await led.subscribe();
    const s = scorer(ctx, id);
    await s.start(A.players[0], A.players[1], B.players[0]);
    await s.ball(1);
    await led.waitFor((e) => e.version === 2);

    // network drop
    led.socket.io.engine.close();
    await sleep(30);
    await s.ball(4, { boundary: true });
    await s.ball(6, { boundary: true });
    await s.ball(2);

    // the client resubscribes on reconnect (as the real clients do) and gets one snapshot
    await led.connected();
    const before = led.received.length;
    await led.subscribe();
    const snap = await led.waitFor((e) => e.type === 'MATCH_STATE_UPDATED' && e.version === 5);
    expect(snap.live.current.runs).toBe(13);
    expect(led.received.length - before).toBe(1);
    led.close();
  });

  it('admin channel requires a valid token and carries the scorer view', async () => {
    const { id } = await seedMatch(ctx);
    const anon = socketClient(ctx, { matchId: id, channel: 'admin' });
    await anon.connected();
    expect(await anon.subscribe()).toMatchObject({ ok: false, error: 'Unauthorized' });
    anon.close();

    const admin = socketClient(ctx, { matchId: id, channel: 'admin', token: ctx.scorerToken });
    await admin.connected();
    expect((await admin.subscribe()).ok).toBe(true);
    const snap = await admin.waitFor((e) => e.type === 'MATCH_STATE_UPDATED');
    expect(snap.live.scorer.battingXI).toHaveLength(11);
    admin.close();
  });

  it('rejects bad subscriptions and isolates match rooms', async () => {
    const m1 = await seedMatch(ctx);
    const m2 = await seedMatch(ctx);
    const v = socketClient(ctx, { matchId: m1.id, channel: 'viewer' });
    await v.connected();
    expect(await new Promise((r) => v.socket.emit('cricket:subscribe', { matchId: 'nope', channel: 'viewer' }, r))).toMatchObject({ ok: false });
    expect(await new Promise((r) => v.socket.emit('cricket:subscribe', { matchId: '000000000000000000000000', channel: 'viewer' }, r))).toMatchObject({ ok: false, error: 'Match not found' });
    await v.subscribe();
    const s2 = scorer(ctx, m2.id);
    await s2.start(m2.A.players[0], m2.A.players[1], m2.B.players[0]);
    await sleep(150);
    expect(v.received.every((e) => e.matchId === m1.id)).toBe(true);
    v.close();
  });

  it('tournament room hears status changes and points updates', async () => {
    const { id, A, B } = await seedMatch(ctx, { overs: 1, maxOversPerBowler: 1 });
    const t = socketClient(ctx, { channel: 'tournament' });
    await t.connected();
    await new Promise((r) => t.socket.emit('cricket:subscribe', { channel: 'tournament' }, r));
    const s = scorer(ctx, id);
    await s.start(A.players[0], A.players[1], B.players[0]);
    await t.waitFor((e) => e.type === 'MATCH_STATUS_CHANGED' && e.status === 'LIVE');
    await s.over(null, [1, 1, 1, 1, 1, 1]);
    await s.start(B.players[0], B.players[1], A.players[0]);
    await s.over(null, [0, 0, 0, 0, 0, 0]);
    await t.waitFor((e) => e.type === 'MATCH_STATUS_CHANGED' && e.status === 'COMPLETED');
    await ctx.http.post(`/api/matches/${id}/confirm-result`).set({ Authorization: `Bearer ${ctx.scorerToken}` }).send({}).expect(200);
    await t.waitFor((e) => e.type === 'POINTS_TABLE_UPDATED');
    await t.waitFor((e) => e.type === 'STATISTICS_UPDATED');
    t.close();
  });

  it('scoring continues when realtime publishing throws', async () => {
    const { id, A, B } = await seedMatch(ctx);
    const original = ctx.io.to.bind(ctx.io);
    ctx.io.to = () => { throw new Error('socket layer down'); };
    try {
      const s = scorer(ctx, id);
      await s.start(A.players[0], A.players[1], B.players[0]);
      await s.ball(4, { boundary: true });
      expect(s.last.current.runs).toBe(4);
    } finally {
      ctx.io.to = original;
    }
  });
});
