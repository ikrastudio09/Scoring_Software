// Integration-test harness: a real server on a random port, against a throwaway database on the
// local mongod (MONGODB_TEST_URI or mongodb://127.0.0.1:27017).
import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import request from 'supertest';
import { io as ioClient } from 'socket.io-client';
import { startServer } from '../../src/index.js';
import { createUser } from '../../src/services/auth.js';
import { invalidateTournamentCache, updateTournament } from '../../src/services/tournament.js';
import { invalidateRuntime } from '../../src/services/runtime.js';
import { invalidatePoints } from '../../src/services/points.js';
import { invalidateStats } from '../../src/services/stats.js';
import { SOCKET_MESSAGE, SOCKET_SUBSCRIBE } from '@cricket/shared';

const BASE = process.env.MONGODB_TEST_URI || 'mongodb://127.0.0.1:27017';

export async function bootServer() {
  const dbName = `cricket_test_${process.pid}_${Date.now()}`;
  const uri = `${BASE}/${dbName}`;
  clearCaches();
  const srv = await startServer({ port: 0, mongoUri: uri });
  await createUser({ username: 'admin', password: 'admin-password-1', role: 'admin' });
  await createUser({ username: 'scorer', password: 'scorer-password-1', role: 'scorer' });
  const http = request(`http://127.0.0.1:${srv.port}`);
  const login = async (username, password) => (await http.post('/api/auth/login').send({ username, password })).body.token;
  const ctx = {
    ...srv,
    uri,
    http,
    url: `http://127.0.0.1:${srv.port}`,
    adminToken: await login('admin', 'admin-password-1'),
    scorerToken: await login('scorer', 'scorer-password-1'),
  };
  ctx.close = async () => {
    await mongoose.connection.db.dropDatabase();
    await srv.stop();
    clearCaches();
  };
  return ctx;
}

export function clearCaches() {
  invalidateRuntime();
  invalidateTournamentCache();
  invalidatePoints();
  invalidateStats();
}

export const auth = (token) => ({ Authorization: `Bearer ${token}` });

/** Create a tournament with two teams of `xi` players and one ready match. */
export async function seedMatch(ctx, { overs = 2, maxOversPerBowler = 1, xi = 11, tossWinner = 'A', decision = 'bat', teams } = {}) {
  await updateTournament({ name: 'Test Cup', rules: { oversPerInnings: overs, maxOversPerBowler, playersPerSide: 11 } });
  const admin = auth(ctx.adminToken);
  let A;
  let B;
  if (teams) {
    [A, B] = teams;
  } else {
    const n = Math.random().toString(36).slice(2, 6);
    A = (await ctx.http.post('/api/teams').set(admin).send({ name: `Alpha ${n}`, shortName: 'ALP' }).expect(201)).body.team;
    B = (await ctx.http.post('/api/teams').set(admin).send({ name: `Bravo ${n}`, shortName: 'BRA' }).expect(201)).body.team;
    A.players = [];
    B.players = [];
    for (let i = 1; i <= xi; i++) {
      A.players.push((await ctx.http.post('/api/players').set(admin).send({ name: `A Player ${i}`, team: A.id }).expect(201)).body.player.id);
      B.players.push((await ctx.http.post('/api/players').set(admin).send({ name: `B Player ${i}`, team: B.id }).expect(201)).body.player.id);
    }
  }
  const match = (await ctx.http.post('/api/matches').set(admin).send({ teamA: A.id, teamB: B.id, venue: 'Main Ground', scheduledAt: new Date().toISOString() }).expect(201)).body.match;
  await ctx.http.post(`/api/matches/${match.id}/setup`).set(admin).send({
    toss: { winner: tossWinner === 'A' ? A.id : B.id, decision },
    playingXI: { teamA: A.players.slice(0, xi), teamB: B.players.slice(0, xi) },
  }).expect(200);
  return { match, A, B, id: match.id };
}

/** A scorer client that tracks the version like the real console does. */
export function scorer(ctx, matchId, token = ctx.scorerToken) {
  const s = {
    version: 0,
    last: null,
    async send(path, body = {}, { expect = 200, clientEventId = randomUUID(), expectedVersion } = {}) {
      const res = await ctx.http.post(`/api/matches/${matchId}/${path}`).set(auth(token))
        .send({ clientEventId, expectedVersion: expectedVersion ?? s.version, ...body });
      if (res.status !== expect) {
        throw new Error(`${path} → ${res.status} (expected ${expect}): ${JSON.stringify(res.body.error || res.body)}`);
      }
      if (res.status === 200) { s.version = res.body.version; s.last = res.body.view; }
      return res;
    },
    start: (strikerId, nonStrikerId, bowlerId) => s.send('innings/start', { strikerId, nonStrikerId, bowlerId }),
    ball: (runs = 0, extra = {}) => s.send('deliveries', { runs, ...extra }),
    bowler: (bowlerId, midOver) => s.send('bowler', { bowlerId, ...(midOver ? { midOver } : {}) }),
    batter: (batterId) => s.send('batter', { batterId }),
    undo: (opts) => s.send('undo', {}, opts),
    endInnings: () => s.send('innings/end', {}),
    async over(bowlerId, runs = [0, 0, 0, 0, 0, 0]) {
      if (bowlerId) await s.bowler(bowlerId);
      for (const r of runs) await s.ball(r, r === 4 || r === 6 ? { boundary: true } : {});
    },
  };
  return s;
}

/** Socket client that subscribes and records every envelope. */
export function socketClient(ctx, { matchId, channel = 'viewer', token, client } = {}) {
  const socket = ioClient(ctx.url, {
    transports: ['websocket'],
    auth: { token, client: client || (channel === 'admin' ? 'admin' : channel) },
    reconnectionDelay: 50,
    reconnectionDelayMax: 200,
  });
  const received = [];
  const waiters = [];
  socket.on(SOCKET_MESSAGE, (env) => {
    received.push(env);
    for (const w of [...waiters]) if (w.pred(env)) { waiters.splice(waiters.indexOf(w), 1); w.resolve(env); }
  });
  const subscribe = () => new Promise((resolve) => socket.emit(SOCKET_SUBSCRIBE, { matchId, channel }, resolve));
  return {
    socket,
    received,
    subscribe,
    connected: () => new Promise((resolve) => (socket.connected ? resolve() : socket.once('connect', resolve))),
    waitFor(pred, ms = 3000) {
      const hit = received.find(pred);
      if (hit) return Promise.resolve(hit);
      return new Promise((resolve, reject) => {
        const w = { pred, resolve };
        waiters.push(w);
        setTimeout(() => { if (waiters.includes(w)) { waiters.splice(waiters.indexOf(w), 1); reject(new Error('timeout waiting for socket event')); } }, ms);
      });
    },
    close: () => socket.close(),
  };
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
