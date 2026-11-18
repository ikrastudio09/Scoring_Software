// Phase 4 reliability: undo restores EVERYTHING clients see (scorer view, scorecard, commentary)
// for every kind of command; LED reconnection; duplicate / stale / out-of-order protection on
// both the server (one broadcast per recorded event) and the client (version guard).
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SOCKET_SUBSCRIBE } from '@cricket/shared';
import { isNewer } from '../../../packages/client/src/live.js';
import { auth, bootServer, finishActiveMatches, scorer, seedMatch, socketClient, sleep } from './harness.js';

let ctx;
beforeAll(async () => { ctx = await bootServer(); });
afterAll(async () => { await ctx?.close(); });

/** Everything a client can see about a match, minus the fields that SHOULD change on undo. */
async function visible(id) {
  const h = auth(ctx.scorerToken);
  const [view, card, comm, live] = await Promise.all([
    ctx.http.get(`/api/matches/${id}/scorer`).set(h).expect(200),
    ctx.http.get(`/api/matches/${id}/scorecard`).expect(200),
    ctx.http.get(`/api/matches/${id}/commentary?limit=300`).expect(200),
    ctx.http.get(`/api/matches/${id}/live`).expect(200),
  ]);
  const strip = ({ version, lastEvent, undo, ...rest }) => rest;
  return { view: strip(view.body.view), card: strip(card.body.scorecard), commentary: comm.body.entries, live: strip(live.body.live) };
}

describe('undo restores the complete previous state', () => {
  it('for every kind of command: view, scorecard, live view and commentary are identical after undo', async () => {
    await finishActiveMatches();
    const { id, A, B } = await seedMatch(ctx, { overs: 2, maxOversPerBowler: 1 });
    const s = scorer(ctx, id);
    const cur = () => s.last.current;

    // [label, () => command] in a legal order; each is applied, undone, compared, re-applied.
    const steps = [
      ['start innings', () => s.start(A.players[0], A.players[1], B.players[0])],
      ['dot', () => s.ball(0)],
      ['single', () => s.ball(1)],
      ['four', () => s.ball(4, { boundary: true })],
      ['six', () => s.ball(6, { boundary: true })],
      ['wide + run', () => s.ball(1, { extra: 'wide' })],
      ['no-ball + 2 off the bat', () => s.ball(2, { extra: 'noball' })],
      ['bye on the free hit', () => s.ball(1, { extra: 'bye' })],
      ['leg bye, over completes', () => s.ball(1, { extra: 'legbye' })],
      ['new bowler', () => s.bowler(B.players[1])],
      ['bowled', () => s.ball(0, { wicket: { type: 'bowled' } })],
      ['new batter', () => s.batter(A.players[2])],
      ['run out of the non-striker after a run', () => s.ball(1, { wicket: { type: 'run_out', batterId: cur().nonStriker.id, fielderId: B.players[3] } })],
      ['new batter 2', () => s.batter(A.players[3])],
      ['retired hurt', () => s.send('retire', { batterId: cur().striker.id, kind: 'retired_hurt' })],
      ['new batter 3', () => s.batter(A.players[4])],
      ['swap strike', () => s.send('swap-strike')],
      ['stumped', () => s.ball(0, { wicket: { type: 'stumped', fielderId: B.players[10] } })],
    ];

    for (const [label, run] of steps) {
      const before = await visible(id);
      await run();
      const after = await visible(id);
      expect(after, `${label} changed nothing`).not.toEqual(before);
      await s.undo();
      expect(await visible(id), `undo of "${label}"`).toEqual(before);
      await run(); // continue the match
    }
    // Undo is itself recorded: the event log keeps every original command plus the undos.
    const { events } = (await ctx.http.get(`/api/matches/${id}/events`).set(auth(ctx.scorerToken)).expect(200)).body;
    expect(events.filter((e) => e.type === 'UNDO')).toHaveLength(steps.length);
    expect(events.filter((e) => e.undone)).toHaveLength(steps.length);
  });

  it('undo of a wicket restores the batter, bowler figures, fall of wickets and partnership', async () => {
    await finishActiveMatches();
    const { id, A, B } = await seedMatch(ctx, { overs: 2 });
    const s = scorer(ctx, id);
    await s.start(A.players[0], A.players[1], B.players[0]);
    await s.ball(4, { boundary: true });
    const card = async () => (await ctx.http.get(`/api/matches/${id}/scorecard`).expect(200)).body.scorecard.innings[0];
    const before = await card();
    await s.ball(0, { wicket: { type: 'caught', fielderId: B.players[2] } });
    const out = await card();
    expect(out.fallOfWickets).toHaveLength(1);
    await s.undo();
    const back = await card();
    expect(back.fallOfWickets).toEqual(before.fallOfWickets);
    expect(back.batting).toEqual(before.batting);
    expect(back.bowling).toEqual(before.bowling);
    expect(back.partnerships).toEqual(before.partnerships);
  });
});

describe('realtime integrity', () => {
  it('a retried command and a rejected (stale) command broadcast nothing', async () => {
    await finishActiveMatches();
    const { id, A, B } = await seedMatch(ctx);
    const viewer = socketClient(ctx, { matchId: id, channel: 'viewer' });
    await viewer.connected();
    await viewer.subscribe();
    const s = scorer(ctx, id);
    await s.start(A.players[0], A.players[1], B.players[0]);
    const key = randomUUID();
    await s.send('deliveries', { runs: 1 }, { clientEventId: key });
    // the network retry of the same request (same id, old version)
    const retry = await s.send('deliveries', { runs: 1 }, { clientEventId: key, expectedVersion: 1 });
    expect(retry.body.duplicate).toBe(true);
    // a double tap on the old screen: rejected as stale
    await s.send('deliveries', { runs: 4, boundary: true }, { expectedVersion: 1, expect: 409 });
    await s.ball(0);
    await viewer.waitFor((e) => e.version === 3);
    await sleep(100);
    const versions = viewer.received.filter((e) => e.version > 0).map((e) => e.version);
    expect(versions).toEqual([1, 2, 3]); // one message per recorded event, nothing else
    viewer.close();
  });

  it('the LED recovers after a network drop with one snapshot, then resumes every ball', async () => {
    await finishActiveMatches();
    const { id, A, B } = await seedMatch(ctx);
    const led = socketClient(ctx, { matchId: id, channel: 'led' });
    await led.connected();
    await led.subscribe();
    const s = scorer(ctx, id);
    await s.start(A.players[0], A.players[1], B.players[0]);
    await led.waitFor((e) => e.version === 1);

    led.socket.disconnect(); // the LED's network drops
    await s.ball(1);
    await s.ball(4, { boundary: true });
    await s.ball(0);
    const missed = led.received.length;

    led.socket.connect();
    await led.connected();
    // Same as the client library: resubscribe on (re)connect → one fresh snapshot
    await new Promise((resolve) => led.socket.emit(SOCKET_SUBSCRIBE, { matchId: id, channel: 'led' }, resolve));
    const snap = await led.waitFor((e, i) => e.type === 'MATCH_STATE_UPDATED' && e.version === 4);
    expect(led.received.length).toBe(missed + 1); // no replay of the missed balls
    expect(snap.live.current).toMatchObject({ runs: 5, wickets: 0, overs: '0.3' });

    await s.ball(2);
    const next = await led.waitFor((e) => e.version === 5);
    expect(next.type).toBe('BALL_RECORDED');
    expect(next.live.current.runs).toBe(7);
    led.close();
  });

  it('every ball message is self-describing (ids, over, runs, extras, wicket, batter, bowler, score)', async () => {
    await finishActiveMatches();
    const { id, A, B } = await seedMatch(ctx);
    const viewer = socketClient(ctx, { matchId: id, channel: 'viewer' });
    await viewer.connected();
    await viewer.subscribe();
    const s = scorer(ctx, id);
    await s.start(A.players[0], A.players[1], B.players[0]);
    await s.ball(2, { extra: 'noball' });
    await s.ball(1, { extra: 'legbye', wicket: { type: 'run_out', batterId: A.players[0], fielderId: B.players[4] } });
    const nb = await viewer.waitFor((e) => e.version === 2);
    expect(nb).toMatchObject({ matchId: id, eventId: `${id}:2`, version: 2, ts: expect.any(Number) });
    expect(nb.ball).toMatchObject({
      seq: 2, innings: 1, over: '0.1', runs: 3, score: '3/0',
      batter: { id: A.players[0], name: 'A Player 1' }, bowler: { id: B.players[0], name: 'B Player 1' },
      extra: { type: 'noball', runs: 1 }, wicket: null,
    });
    const ro = await viewer.waitFor((e) => e.version === 3);
    expect(ro.type).toBe('WICKET');
    expect(ro.ball).toMatchObject({ extra: { type: 'legbye', runs: 1 }, wicket: { type: 'run_out', batter: { id: A.players[0] } }, score: '4/1' });
    expect(ro.live.current).toMatchObject({ wickets: 1, freeHit: false });
    viewer.close();
  });
});

describe('client version guard (packages/client isNewer)', () => {
  // The order a flaky network might deliver messages in, and what a client must keep.
  const apply = (msgs) => {
    let version = null;
    const shown = [];
    for (const m of msgs) {
      if (!isNewer(m, version)) continue;
      version = m.version;
      shown.push(`${m.type}@${m.version}`);
    }
    return { version, shown };
  };

  it('drops stale, duplicate and out-of-order messages; never regresses', () => {
    const out = apply([
      { type: 'MATCH_STATE_UPDATED', version: 5 }, // subscribe snapshot
      { type: 'BALL_RECORDED', version: 4 }, // stale (sent before the snapshot was taken)
      { type: 'BALL_RECORDED', version: 6 },
      { type: 'BALL_RECORDED', version: 6 }, // duplicate delivery
      { type: 'BALL_RECORDED', version: 8 }, // out of order: arrives before 7
      { type: 'BALL_RECORDED', version: 7 }, // late: must not overwrite 8
      { type: 'MATCH_STATE_UPDATED', version: 8 }, // same-version snapshot (result confirmed): replaces in place
      { type: 'MATCH_STATE_UPDATED', version: 7 }, // old snapshot after a reconnect race: ignored
    ]);
    expect(out.shown).toEqual(['MATCH_STATE_UPDATED@5', 'BALL_RECORDED@6', 'BALL_RECORDED@8', 'MATCH_STATE_UPDATED@8']);
    expect(out.version).toBe(8);
  });

  it('an undo arrives as a newer version, so it is always applied', () => {
    expect(apply([{ type: 'BALL_RECORDED', version: 9 }, { type: 'EVENT_UNDONE', version: 10 }]).shown).toEqual(['BALL_RECORDED@9', 'EVENT_UNDONE@10']);
  });
});
