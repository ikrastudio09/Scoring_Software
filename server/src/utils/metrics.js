// In-process metrics. Small and dependency-free; exposed on GET /api/metrics.
import { monitorEventLoopDelay } from 'node:perf_hooks';

const LOOP_RES_MS = 10;
const loop = monitorEventLoopDelay({ resolution: LOOP_RES_MS });
loop.enable();

class Window {
  constructor(size = 1000) { this.size = size; this.values = []; this.count = 0; }
  add(v) { this.values.push(v); this.count++; if (this.values.length > this.size) this.values.shift(); }
  summary() {
    const s = [...this.values].sort((a, b) => a - b);
    const q = (p) => (s.length ? +s[Math.min(s.length - 1, Math.floor(p * s.length))].toFixed(2) : null);
    return { count: this.count, p50: q(0.5), p95: q(0.95), p99: q(0.99), max: s.length ? +s.at(-1).toFixed(2) : null };
  }
}

const startedAt = Date.now();
const state = {
  http: { requests: 0, errors5xx: 0, errors4xx: 0, latency: new Window() },
  scoring: { commands: 0, rejected: 0, duplicates: 0, latency: new Window(), dbWrite: new Window() },
  sockets: { connected: 0, byChannel: { admin: 0, led: 0, viewer: 0 }, emitted: 0, connects: 0, disconnects: 0 },
  stats: { rebuilds: 0, failures: 0 },
};

export const metrics = {
  state,
  httpRequest(status, ms) {
    state.http.requests++;
    if (status >= 500) state.http.errors5xx++;
    else if (status >= 400) state.http.errors4xx++;
    state.http.latency.add(ms);
  },
  scoringCommand(ms, dbMs) { state.scoring.commands++; state.scoring.latency.add(ms); if (dbMs !== undefined) state.scoring.dbWrite.add(dbMs); },
  scoringRejected() { state.scoring.rejected++; },
  scoringDuplicate() { state.scoring.duplicates++; },
  snapshot(extra = {}) {
    const mem = process.memoryUsage();
    const cpu = process.cpuUsage();
    return {
      uptimeSec: Math.round((Date.now() - startedAt) / 1000),
      memoryMb: { rss: +(mem.rss / 1048576).toFixed(1), heapUsed: +(mem.heapUsed / 1048576).toFixed(1) },
      cpuSec: { user: +(cpu.user / 1e6).toFixed(2), system: +(cpu.system / 1e6).toFixed(2) },
      // The histogram includes the sampling interval itself; report only the lag beyond it.
      eventLoopDelayMs: Object.fromEntries([['p50', loop.percentile(50)], ['p99', loop.percentile(99)], ['max', loop.max]]
        .map(([k, ns]) => [k, +Math.max(0, ns / 1e6 - LOOP_RES_MS).toFixed(2)])),
      http: { ...state.http, latency: state.http.latency.summary() },
      scoring: { ...state.scoring, latency: state.scoring.latency.summary(), dbWrite: state.scoring.dbWrite.summary() },
      sockets: state.sockets,
      stats: state.stats,
      ...extra,
    };
  },
};
