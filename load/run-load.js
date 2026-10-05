// Load & latency test against a REAL server process.
//
//   node load/run-load.js [--viewers 500] [--matches 4] [--ballMs 250] [--balls 120] [--httpConcurrency 50] [--httpRps 0]
//
// Boots the server as a child process on a throwaway database (cricket_load), seeds the sample
// tournament, then simultaneously:
//   * connects N viewer sockets + 1 LED socket per match (+ tournament room subscriptions)
//   * runs M matches in parallel, each scorer recording a command every --ballMs via the REST API
//     (realistic is ~1 ball / 30 s — this is >100× faster than real play)
//   * hammers public GET endpoints with --httpConcurrency parallel clients
//   * finishes with a reconnect storm (all viewers drop and reconnect at once)
// and reports API, LED and viewer latency, error counts and server CPU / memory / event-loop delay.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { io } from 'socket.io-client';
import { nextCommand, rng } from '../server/scripts/lib/simulate.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name, d) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? Number(process.argv[i + 1]) : d; };
const VIEWERS = arg('viewers', 500);
const MATCHES = arg('matches', 4);
const BALL_MS = arg('ballMs', 250);
const MAX_COMMANDS = arg('balls', 120);
const HTTP_CONC = arg('httpConcurrency', 50);
const HTTP_RPS = arg('httpRps', 0); // 0 = as fast as possible
const PORT = arg('port', 4300);
const BASE = `http://127.0.0.1:${PORT}`;
const DB = `mongodb://127.0.0.1:27017/cricket_load`;

const stats = (arr) => {
  const s = [...arr].sort((a, b) => a - b);
  const q = (p) => (s.length ? +s[Math.min(s.length - 1, Math.floor(p * s.length))].toFixed(1) : null);
  return { n: s.length, p50: q(0.5), p95: q(0.95), p99: q(0.99), max: s.length ? +s.at(-1).toFixed(1) : null };
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function run(cmd, args, env, { wait = true } = {}) {
  const child = spawn(cmd, args, { cwd: root, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });
  if (!wait) return child;
  return new Promise((resolve, reject) => child.on('exit', (code) => (code === 0 ? resolve(out) : reject(new Error(`${args.join(' ')} failed:\n${out}`)))));
}

async function api(method, p, body, token) {
  const res = await fetch(`${BASE}/api${p}`, {
    method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = res.status === 204 ? null : await res.json();
  if (!res.ok) { const e = new Error(data?.error?.message || res.status); e.status = res.status; e.data = data; throw e; }
  return data;
}

const env = {
  NODE_ENV: 'production', MONGODB_URI: DB, PORT: String(PORT), JWT_SECRET: 'load-test-secret-load-test-secret-123456',
  ADMIN_USERNAME: 'admin', ADMIN_PASSWORD: 'load-admin-password', LOG_LEVEL: 'warn', SERVE_STATIC: 'false',
  // All simulated clients share one IP here; the per-IP public limit is lifted for the test.
  RATE_LIMIT_PUBLIC_PER_MIN: '1000000', CORS_ORIGINS: 'http://localhost',
};

console.log('seeding database…');
await run('node', ['server/scripts/seed.js', '--reset', '--force', '--simulate', '6'], env);
console.log(`starting server on ${PORT}…`);
const server = run('node', ['server/src/index.js'], env, { wait: false });
let serverLog = '';
server.stdout.on('data', (d) => { serverLog += d; });
server.stderr.on('data', (d) => { serverLog += d; });
for (let i = 0; i < 100; i++) {
  try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch { /* starting */ }
  await sleep(200);
}

const report = { config: { VIEWERS, MATCHES, BALL_MS, MAX_COMMANDS, HTTP_CONC, HTTP_RPS }, at: new Date().toISOString() };
try {
  const { token } = await api('POST', '/auth/login', { username: 'admin', password: 'load-admin-password' });

  // ── pick M scheduled matches and set them up ──
  const { matches } = await api('GET', '/matches?status=SCHEDULED');
  const chosen = matches.filter((m) => m.teamA?.id && m.teamB?.id).slice(0, MATCHES);
  for (const m of chosen) {
    const [a, b] = await Promise.all([api('GET', `/teams/${m.teamA.id}`), api('GET', `/teams/${m.teamB.id}`)]);
    await api('POST', `/matches/${m.id}/setup`, {
      toss: { winner: m.teamA.id, decision: 'bat' },
      playingXI: { teamA: a.team.squad.slice(0, 11).map((p) => p.id), teamB: b.team.squad.slice(0, 11).map((p) => p.id) },
    }, token);
  }
  const ids = chosen.map((m) => m.id);
  const metricsBefore = await api('GET', '/admin/metrics', null, token);

  // ── sockets ──
  const sendTimes = new Map(); // `${matchId}:${version}` → t
  const ledLat = [];
  const viewerLat = [];
  const viewerEventsPerSocket = [];
  let socketErrors = 0;
  const connectStart = performance.now();
  const mkSocket = (channel, matchId, onEnv) => new Promise((resolve) => {
    const s = io(BASE, { transports: ['websocket'], auth: { client: channel }, reconnectionDelay: 200, reconnectionDelayMax: 2000 });
    s.on('connect_error', () => { socketErrors++; });
    s.on('cricket:event', onEnv);
    s.on('connect', () => s.emit('cricket:subscribe', { matchId, channel }, () => resolve(s)));
  });
  const leds = await Promise.all(ids.map((id) => mkSocket('led', id, (e) => {
    const t = sendTimes.get(`${e.matchId}:${e.version}`);
    if (t && e.effects?.length) ledLat.push(performance.now() - t); // effects [] = subscribe snapshot
  })));
  const viewers = [];
  for (let i = 0; i < VIEWERS; i += 50) {
    viewers.push(...await Promise.all(Array.from({ length: Math.min(50, VIEWERS - i) }, (_, k) => {
      const idx = i + k;
      viewerEventsPerSocket[idx] = 0;
      return mkSocket('viewer', ids[idx % ids.length], (e) => {
        const t = sendTimes.get(`${e.matchId}:${e.version}`);
        if (t && e.effects?.length) { viewerLat.push(performance.now() - t); viewerEventsPerSocket[idx]++; }
      });
    })));
  }
  report.connect = { sockets: viewers.length + leds.length, ms: +(performance.now() - connectStart).toFixed(0) };
  console.log(`connected ${viewers.length} viewers + ${leds.length} LEDs in ${report.connect.ms} ms`);

  // ── public HTTP load ──
  let stopHttp = false;
  const httpLat = [];
  let httpErrors = 0;
  const paths = ['/home', '/points-table', '/stats/leaderboards', '/matches', ...ids.map((id) => `/matches/${id}/live`), ...ids.map((id) => `/matches/${id}/scorecard`)];
  const httpWorker = async (w) => {
    let i = w;
    while (!stopHttp) {
      const t = performance.now();
      try { const r = await fetch(`${BASE}/api${paths[i++ % paths.length]}`); await r.arrayBuffer(); if (!r.ok) httpErrors++; } catch { httpErrors++; }
      httpLat.push(performance.now() - t);
      if (HTTP_RPS) await sleep(Math.max(0, (HTTP_CONC / HTTP_RPS) * 1000 - (performance.now() - t)));
    }
  };
  const httpWorkers = Array.from({ length: HTTP_CONC }, (_, w) => httpWorker(w));

  // ── scorers ──
  const cmdLat = [];
  let cmdErrors = 0;
  let commands = 0;
  const scorer = async (matchId, seed) => {
    const r = rng(seed);
    let view = (await api('GET', `/matches/${matchId}/scorer`, null, token)).view;
    for (let n = 0; n < MAX_COMMANDS && view.state !== 'COMPLETED'; n++) {
      const cmd = nextCommand(view, r);
      const pathFor = { START_INNINGS: 'innings/start', DELIVERY: 'deliveries', SET_BOWLER: 'bowler', NEW_BATTER: 'batter', END_INNINGS: 'innings/end' }[cmd.type];
      const t = performance.now();
      sendTimes.set(`${matchId}:${view.version + 1}`, t);
      try {
        const out = await api('POST', `/matches/${matchId}/${pathFor}`, { ...cmd.payload, clientEventId: randomUUID(), expectedVersion: view.version }, token);
        cmdLat.push(performance.now() - t);
        view = out.view;
        commands++;
      } catch (e) {
        cmdErrors++;
        view = (await api('GET', `/matches/${matchId}/scorer`, null, token)).view;
      }
      await sleep(BALL_MS);
    }
  };
  const t0 = performance.now();
  await Promise.all(ids.map((id, i) => scorer(id, i + 7)));
  const scoringSecs = (performance.now() - t0) / 1000;
  stopHttp = true;
  await Promise.all(httpWorkers);
  await sleep(500);

  // ── reconnect storm ──
  const stormStart = performance.now();
  let recovered = 0;
  await Promise.all(viewers.map((s) => new Promise((resolve) => {
    const onSnap = (e) => { if (e.type === 'MATCH_STATE_UPDATED') { s.off('cricket:event', onSnap); recovered++; resolve(); } };
    s.once('connect', () => { s.on('cricket:event', onSnap); s.emit('cricket:subscribe', { matchId: ids[viewers.indexOf(s) % ids.length], channel: 'viewer' }); });
    s.io.engine.close(); // simulate network drop; socket.io reconnects automatically
  })));
  report.reconnectStorm = { sockets: viewers.length, recovered, allRecoveredMs: +(performance.now() - stormStart).toFixed(0) };

  const metricsAfter = await api('GET', '/admin/metrics', null, token);
  const verify = await api('POST', '/admin/reconcile', {}, token);

  report.scoring = {
    commands, errors: cmdErrors, durationSec: +scoringSecs.toFixed(1),
    commandsPerSec: +(commands / scoringSecs).toFixed(1),
    apiLatencyMs: stats(cmdLat),
    serverSideMs: metricsAfter.scoring.latency, dbWriteMs: metricsAfter.scoring.dbWrite,
  };
  report.led = { updatesReceived: ledLat.length, expected: commands, sendToLedMs: stats(ledLat) };
  const viewerMsgs = viewerEventsPerSocket.reduce((a, b) => a + b, 0);
  report.viewers = {
    deliveries: viewerLat.length, avgMessagesPerViewer: +(viewerMsgs / VIEWERS).toFixed(1),
    sendToViewerMs: stats(viewerLat), note: 'viewers only receive overs, wickets and innings/match events',
  };
  report.http = { requests: httpLat.length, errors: httpErrors, rps: +(httpLat.length / scoringSecs).toFixed(0), latencyMs: stats(httpLat) };
  report.server = {
    memoryMb: { before: metricsBefore.memoryMb, after: metricsAfter.memoryMb },
    cpuSec: { user: +(metricsAfter.cpuSec.user - metricsBefore.cpuSec.user).toFixed(2), system: +(metricsAfter.cpuSec.system - metricsBefore.cpuSec.system).toFixed(2) },
    cpuPercentOfOneCore: +(((metricsAfter.cpuSec.user + metricsAfter.cpuSec.system - metricsBefore.cpuSec.user - metricsBefore.cpuSec.system) / scoringSecs) * 100).toFixed(1),
    eventLoopDelayMs: metricsAfter.eventLoopDelayMs,
    http5xx: metricsAfter.http.errors5xx,
    socketsConnected: metricsAfter.sockets.connected,
    socketErrors,
  };
  report.consistency = verify;

  for (const s of [...viewers, ...leds]) s.close();
  fs.mkdirSync(path.join(root, 'load/results'), { recursive: true });
  const file = path.join(root, 'load/results', `load-${Date.now()}.json`);
  fs.writeFileSync(file, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  console.log(`report: ${file}`);
} catch (err) {
  console.error(err);
  console.error(serverLog.slice(-3000));
  process.exitCode = 1;
} finally {
  server.kill();
}
