// Micro-benchmark of the engine hot path: clone + apply at end-of-match state size, and full replay.
// Usage: node load/engine-bench.js
import { applyEvent, createState, replay } from '../server/src/engine/index.js';

const xi = (p) => Array.from({ length: 11 }, (_, i) => `${p}${i + 1}`);
const setup = {
  rules: { oversPerInnings: 10, ballsPerOver: 6, maxOversPerBowler: 2 },
  battingFirst: 'A', bowlingFirst: 'B', xi: { A: xi('a'), B: xi('b') },
};

const events = [];
const state = createState(setup);
const push = (type, payload) => {
  const ev = { type, payload, seq: events.length + 1 };
  applyEvent(state, setup, ev);
  events.push(ev);
};
push('START_INNINGS', { strikerId: 'a1', nonStrikerId: 'a2', bowlerId: 'b1' });
for (let o = 0; o < 10; o++) {
  if (o > 0) push('SET_BOWLER', { bowlerId: `b${(o % 5) + 1}` });
  for (let b = 0; b < 6; b++) {
    if (b === 2) push('DELIVERY', { runs: 0, extra: 'wide' });
    push('DELIVERY', { runs: b % 3 });
  }
}
push('START_INNINGS', { strikerId: 'b1', nonStrikerId: 'b2', bowlerId: 'a1' });
for (let o = 0; o < 9 && state.status !== 'COMPLETED'; o++) {
  if (o > 0) push('SET_BOWLER', { bowlerId: `a${(o % 5) + 1}` });
  for (let b = 0; b < 6 && state.status !== 'COMPLETED'; b++) push('DELIVERY', { runs: b % 2 });
}

const N = 2000;
let t = performance.now();
for (let i = 0; i < N; i++) structuredClone(state);
const cloneMs = (performance.now() - t) / N;
t = performance.now();
for (let i = 0; i < 200; i++) replay(setup, events);
const replayMs = (performance.now() - t) / 200;
console.log(JSON.stringify({
  events: events.length,
  stateBytes: JSON.stringify(state).length,
  cloneMs: +cloneMs.toFixed(3),
  fullReplayMs: +replayMs.toFixed(3),
}));
