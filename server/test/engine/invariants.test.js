// Property-style tests: play many random matches through the engine and check cricket
// invariants after every accepted event. Illegal commands are attempted on purpose and must be
// rejected without changing state. Seeded, so failures are reproducible.

import assert from 'node:assert/strict';
import { describe, it, expect } from 'vitest';
import { applyEvent, createState, currentInnings, replay, MATCH_STATE, toScorerView } from '../../src/engine/index.js';
import { makeSetup, meta } from './helpers.js';

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const sum = (arr, f) => arr.reduce((s, x) => s + f(x), 0);

// Minimal fast matcher for the hot loop (vitest's expect is too slow for millions of checks).
const check = (actual) => ({
  toBe: (v) => assert.equal(actual, v),
  toBeLessThanOrEqual: (v) => assert.ok(actual <= v, `${actual} <= ${v}`),
  toBeLessThan: (v) => assert.ok(actual < v, `${actual} < ${v}`),
  toBeGreaterThan: (v) => assert.ok(actual > v, `${actual} > ${v}`),
  not: { toBe: (v) => assert.notEqual(actual, v) },
});

function checkInvariants(state, setup) {
  const bpo = setup.rules.ballsPerOver;
  for (const inn of state.innings) {
    const balls = inn.overs.flatMap((o) => o.balls);
    const batters = Object.values(inn.batters);
    const bowlers = Object.values(inn.bowlers);

    // Team score equals the sum of all deliveries, and splits exactly into bat runs + extras.
    check(inn.runs).toBe(sum(balls, (b) => b.total));
    check(inn.runs).toBe(sum(batters, (b) => b.runs) + inn.extras.total);
    check(inn.extras.total).toBe(inn.extras.wides + inn.extras.noBalls + inn.extras.byes + inn.extras.legByes);
    // Bowlers are charged everything except byes and leg byes.
    check(sum(bowlers, (b) => b.runs)).toBe(inn.runs - inn.extras.byes - inn.extras.legByes);

    // Ball counts.
    check(inn.legalBalls).toBe(balls.filter((b) => b.legal).length);
    check(inn.legalBalls).toBe(sum(bowlers, (b) => b.legalBalls));
    check(inn.legalBalls).toBeLessThanOrEqual(inn.maxBalls);
    for (const o of inn.overs) {
      check(o.legalBalls).toBeLessThanOrEqual(bpo);
      if (o !== inn.overs.at(-1)) check(o.legalBalls).toBe(bpo);
    }
    check(sum(batters, (b) => b.balls)).toBe(balls.filter((b) => b.extra !== 'wide').length);

    // Wickets.
    check(inn.wickets).toBeLessThanOrEqual(inn.maxWickets);
    check(inn.wickets).toBe(batters.filter((b) => b.status === 'out').length);
    check(inn.wickets).toBe(inn.fallOfWickets.length);
    check(sum(bowlers, (b) => b.wickets)).toBeLessThanOrEqual(inn.wickets);

    // Batters at the crease.
    for (const id of [inn.striker, inn.nonStriker]) {
      if (id) check(inn.batters[id].status).toBe('batting');
    }
    if (inn.striker && inn.nonStriker) check(inn.striker).not.toBe(inn.nonStriker);

    // Bowling limit and consecutive overs.
    for (const b of bowlers) check(b.oversStarted).toBeLessThanOrEqual(setup.rules.maxOversPerBowler);
    for (let i = 1; i < inn.overs.length; i++) {
      const prev = new Set(inn.overs[i - 1].balls.map((b) => b.bowler));
      for (const b of inn.overs[i].balls) check(prev.has(b.bowler)).toBe(false);
    }

    // Partnerships account for every run.
    check(sum(inn.partnerships, (p) => p.runs) + (inn.currentPartnership?.runs ?? 0)).toBe(inn.runs);

    // Chase: once the target is reached the innings and match are over.
    if (inn.target !== null && inn.runs >= inn.target) {
      check(inn.status).toBe('COMPLETED');
      check(state.status).toBe(MATCH_STATE.COMPLETED);
    }
    if (inn.status === 'IN_PROGRESS') {
      check(inn.legalBalls).toBeLessThan(inn.maxBalls);
      check(inn.wickets).toBeLessThan(inn.maxWickets);
    }
  }

  if (state.status === MATCH_STATE.COMPLETED && state.result?.type === 'win' && state.innings.length === 2) {
    const [a, b] = state.innings;
    const winnerRuns = state.result.winner === a.battingTeam ? a.runs : b.runs;
    const loserRuns = state.result.winner === a.battingTeam ? b.runs : a.runs;
    check(winnerRuns).toBeGreaterThan(loserRuns);
  }
  if (state.result?.type === 'tie') check(state.innings[0].runs).toBe(state.innings[1].runs);
}

const DISMISSALS = ['bowled', 'caught', 'caught_and_bowled', 'lbw', 'run_out', 'stumped', 'hit_wicket', 'obstructing_field', 'hit_ball_twice'];

function randomCommand(r, state, setup) {
  const pick = (arr) => arr[Math.floor(r() * arr.length)];
  let cached;
  const scorer = () => (cached ??= toScorerView(state, setup, meta(setup)).scorer);
  const inn = currentInnings(state);

  if (state.status === MATCH_STATE.NOT_STARTED || state.status === MATCH_STATE.INNINGS_BREAK) {
    if (r() < 0.02) return { type: 'CONCLUDE', payload: { resultType: 'no_result' } };
    const bat = scorer().battingXI.map((p) => p.id);
    const bowl = scorer().bowlingXI.map((p) => p.id);
    const s = pick(bat);
    // ~10% deliberately invalid: same opener twice
    const ns = r() < 0.1 ? s : pick(bat.filter((x) => x !== s));
    return { type: 'START_INNINGS', payload: { strikerId: s, nonStrikerId: ns, bowlerId: pick(bowl) } };
  }
  if (!inn.striker || !inn.nonStriker) {
    if (r() < 0.05) return { type: 'DELIVERY', payload: { runs: 1 } }; // must be rejected
    const options = scorer().yetToBat.map((p) => p.id);
    if (!options.length) return { type: 'END_INNINGS', payload: { reason: 'no_batters' } };
    return { type: 'NEW_BATTER', payload: { batterId: pick(options) } };
  }
  if (!inn.bowler) {
    // sometimes try an unavailable bowler (must be rejected)
    const all = scorer().bowlers;
    const avail = all.filter((b) => b.available);
    const choice = r() < 0.15 || !avail.length ? pick(all) : pick(avail);
    return { type: 'SET_BOWLER', payload: { bowlerId: choice.id } };
  }

  const x = r();
  if (x < 0.01) return { type: 'SWAP_STRIKE', payload: {} };
  if (x < 0.015) return { type: 'RETIRE', payload: { batterId: pick([inn.striker, inn.nonStriker]), kind: pick(['retired_hurt', 'retired_out']) } };
  if (x < 0.02) return { type: 'SET_BOWLER', payload: { bowlerId: pick(scorer().bowlers).id, midOver: true } };
  if (x < 0.022) return { type: 'END_INNINGS', payload: {} };

  const extra = pick([null, null, null, null, null, null, 'wide', 'noball', 'bye', 'legbye']);
  let runs = pick([0, 0, 0, 1, 1, 1, 2, 2, 3, 4, 4, 6, 5, 7]);
  const boundary = (runs === 4 || runs === 6) && r() < 0.8;
  const payload = { extra, runs, boundary };
  if (extra === 'noball') payload.noBallRunsType = pick(['bat', 'bat', 'bye', 'legbye']);
  if (r() < 0.12) {
    const type = pick(DISMISSALS);
    payload.wicket = { type };
    if (r() < 0.7 && type !== 'run_out') payload.runs = 0;
    if (type === 'run_out' || type === 'obstructing_field') payload.wicket.batterId = pick([inn.striker, inn.nonStriker]);
    if (type === 'caught' || (type === 'run_out' && r() < 0.5) || type === 'stumped') {
      payload.wicket.fielderId = pick(scorer().bowlingXI).id;
    }
  }
  return { type: 'DELIVERY', payload };
}

function playMatch(seed, ruleOverrides) {
  const r = rng(seed);
  const setup = makeSetup({ oversPerInnings: 8, maxOversPerBowler: 2, ...ruleOverrides });
  let state = createState(setup);
  const events = [];
  const history = [structuredClone(state)];
  let accepted = 0;
  let rejected = 0;

  for (let step = 0; step < 2000 && state.status !== MATCH_STATE.COMPLETED; step++) {
    // Undo: replaying all-but-last must reproduce the state before the last event.
    if (events.length && r() < 0.03) {
      events.pop();
      history.pop();
      state = replay(setup, events);
      const expected = history.at(-1);
      assert.deepEqual({ ...state, version: 0, lastEvent: null }, { ...expected, version: 0, lastEvent: null });
      continue;
    }
    const cmd = randomCommand(r, state, setup);
    const ev = { ...cmd, seq: events.length + 1 };
    const next = structuredClone(state);
    try {
      applyEvent(next, setup, ev);
    } catch (e) {
      if (e.name !== 'ScoringError') throw e;
      rejected++;
      continue; // `state` untouched by construction
    }
    state = next;
    events.push(ev);
    history.push(structuredClone(state));
    accepted++;
    checkInvariants(state, setup);
  }

  expect(state.status).toBe(MATCH_STATE.COMPLETED);
  // Completed match rejects anything.
  expect(() => applyEvent(structuredClone(state), setup, { type: 'DELIVERY', payload: { runs: 1 }, seq: 99999 })).toThrow();
  // Full replay reproduces the final state.
  const replayed = replay(setup, events);
  expect({ ...replayed, version: 0, lastEvent: null }).toEqual({ ...state, version: 0, lastEvent: null });
  return { accepted, rejected, state };
}

describe('engine invariants over random matches', () => {
  it('300 random 8-over matches keep every invariant', { timeout: 180000 }, () => {
    let totalAccepted = 0;
    let totalRejected = 0;
    const results = {};
    for (let seed = 1; seed <= 300; seed++) {
      const { accepted, rejected, state } = playMatch(seed);
      totalAccepted += accepted;
      totalRejected += rejected;
      results[state.result.type] = (results[state.result.type] || 0) + 1;
    }
    // Make sure the generator actually exercises both acceptance and rejection paths.
    expect(totalAccepted).toBeGreaterThan(20000);
    expect(totalRejected).toBeGreaterThan(1000);
    expect(results.win).toBeGreaterThan(100);
  });

  it('random 10-over matches with small XIs, free hit off and 2-run penalties', { timeout: 180000 }, () => {
    for (let seed = 1000; seed < 1100; seed++) {
      playMatch(seed, { oversPerInnings: 10, xiSize: 7, freeHit: false, wideRuns: 2, noBallRuns: 2 });
    }
  });
});
