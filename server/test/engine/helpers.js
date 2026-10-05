import { expect } from 'vitest';
import { applyEvent, createState, currentInnings, replay } from '../../src/engine/index.js';

export const A = 'A';
export const B = 'B';

export function makeSetup({ xiSize = 11, ...rules } = {}) {
  const xi = (p) => Array.from({ length: xiSize }, (_, i) => `${p}${i + 1}`);
  return {
    rules: { oversPerInnings: 2, ballsPerOver: 6, maxOversPerBowler: 2, wideRuns: 1, noBallRuns: 1, freeHit: true, ...rules },
    battingFirst: A,
    bowlingFirst: B,
    xi: { [A]: xi('a'), [B]: xi('b') },
  };
}

export const meta = (setup) => ({
  matchId: 'm1',
  teams: { [A]: { name: 'Alpha', shortName: 'ALP' }, [B]: { name: 'Bravo', shortName: 'BRA' } },
  players: Object.fromEntries([...setup.xi[A], ...setup.xi[B]].map((id) => [id, { name: id.toUpperCase() }])),
});

/** Drives the engine like the scoring service does: clone, apply, keep on success. */
export class Sim {
  constructor(setup = makeSetup()) {
    this.setup = setup;
    this.state = createState(setup);
    this.events = [];
    this.lastEffects = [];
  }

  do(type, payload = {}) {
    const ev = { type, payload, seq: this.events.length + 1 };
    const next = structuredClone(this.state);
    this.lastEffects = applyEvent(next, this.setup, ev);
    this.state = next;
    this.events.push(ev);
    return this;
  }

  get inn() { return currentInnings(this.state); }
  batter(id) { return this.inn.batters[id]; }
  bowler(id) { return this.inn.bowlers[id]; }

  start(striker = 'a1', nonStriker = 'a2', bowler = 'b1') { return this.do('START_INNINGS', { strikerId: striker, nonStrikerId: nonStriker, bowlerId: bowler }); }
  start2(striker = 'b1', nonStriker = 'b2', bowler = 'a1') { return this.start(striker, nonStriker, bowler); }
  ball(runs = 0, opts = {}) { return this.do('DELIVERY', { runs, ...opts }); }
  dots(n) { for (let i = 0; i < n; i++) this.ball(0); return this; }
  four() { return this.ball(4, { boundary: true }); }
  six() { return this.ball(6, { boundary: true }); }
  wide(runs = 0, opts = {}) { return this.ball(runs, { extra: 'wide', ...opts }); }
  noball(runs = 0, opts = {}) { return this.ball(runs, { extra: 'noball', ...opts }); }
  bye(runs) { return this.ball(runs, { extra: 'bye' }); }
  legbye(runs) { return this.ball(runs, { extra: 'legbye' }); }
  out(type, opts = {}) {
    const { runs = 0, extra, batterId, fielderId, substituteFielder } = opts;
    return this.ball(runs, { extra, wicket: { type, batterId, fielderId, substituteFielder } });
  }
  setBowler(id, midOver = false) { return this.do('SET_BOWLER', { bowlerId: id, midOver }); }
  newBatter(id, end) { return this.do('NEW_BATTER', { batterId: id, end }); }

  /** Bowl a full over of dots with the given bowler (sets the bowler first if needed). */
  overOfDots(bowler) {
    if (bowler && this.inn.bowler !== bowler) this.setBowler(bowler);
    return this.dots(this.setup.rules.ballsPerOver - this.inn.overs.at(-1).legalBalls);
  }

  /** Asserts that replaying the event log rebuilds exactly the incremental state. */
  assertReplayable() {
    expect(replay(this.setup, this.events)).toEqual(this.state);
    return this;
  }
}

export function expectScoringError(fn, code) {
  let err;
  try { fn(); } catch (e) { err = e; }
  expect(err, `expected ScoringError ${code}`).toBeDefined();
  expect(err.name).toBe('ScoringError');
  expect(err.code).toBe(code);
  return err;
}
