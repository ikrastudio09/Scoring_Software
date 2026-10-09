import { describe, expect, it } from 'vitest';
import { buildCommentary } from '../../src/engine/index.js';
import { Sim, makeSetup, meta } from './helpers.js';

const feed = (sim, overrides) => buildCommentary(sim.state, sim.setup, meta(sim.setup), overrides);
const last = (sim) => feed(sim).at(-1);

describe('deterministic commentary', () => {
  it('describes every kind of delivery from the structured event', () => {
    const sim = new Sim(makeSetup({ oversPerInnings: 5, maxOversPerBowler: 3 })).start();
    const cases = [
      [() => sim.ball(0), 'dot', /^B1 to A1, (no run|dot ball)/],
      [() => sim.ball(1), 'runs', /^B1 to A1, 1 run/],
      [() => sim.ball(2), 'runs', /^B1 to A2, 2 runs/],
      [() => sim.ball(3), 'runs', /^B1 to A2, 3 runs/],
      [() => sim.four(), 'four', /^B1 to A1, FOUR!/],
      [() => sim.six(), 'six', /^B1 to A1, SIX!/],
      [() => sim.wide(), 'wide', /WIDE\. 1 extra added\./],
      [() => sim.noball(1), 'noball', /NO-BALL, 1 run off the bat\./],
      [() => sim.bye(1), 'bye', /1 bye\./],
      [() => sim.legbye(2), 'legbye', /2 leg byes\./],
    ];
    for (const [act, kind, re] of cases) {
      if (!sim.inn.bowler) sim.setBowler('b2'); // new over
      act();
      const e = last(sim);
      expect(e.kind).toBe(kind);
      expect(e.text).toMatch(re);
    }
  });

  it('names the dismissal and the fielder for every wicket type', () => {
    const types = [
      ['bowled', {}, /OUT! Bowled\. B1 hits the stumps\./],
      ['caught', { fielderId: 'b5' }, /OUT! Caught by B5\./],
      ['caught_and_bowled', {}, /OUT! Caught and bowled by B1\./],
      ['lbw', {}, /OUT! LBW/],
      ['stumped', { fielderId: 'b2' }, /OUT! Stumped by B2/],
      ['hit_wicket', {}, /OUT! Hit wicket\./],
      ['run_out', { fielderId: 'b3', runs: 1 }, /OUT! A\d+ run out by B3 after 1 run\./],
    ];
    for (const [type, opts, re] of types) {
      const sim = new Sim(makeSetup()).start();
      sim.out(type, opts);
      const e = last(sim);
      expect(e.kind).toBe('wicket');
      expect(e.text).toMatch(re);
      expect(e.milestones[0]).toMatch(/Alpha \d+\/1\./);
    }
  });

  it('uses cricket ball numbering, adds the score line and an end-of-over summary', () => {
    const sim = new Sim(makeSetup({ oversPerInnings: 3 })).start();
    sim.ball(1).wide().ball(0).four().ball(0).ball(2).ball(1); // over 1: 9 runs incl. a wide
    const f = feed(sim);
    expect(f.map((e) => e.over)).toEqual(['0.1', '0.2', '0.2', '0.3', '0.4', '0.5', '0.6']);
    expect(f[1].scoreText).toBe('Alpha move to 2/0.');
    expect(f[2].scoreText).toBe('Alpha remain on 2/0.');
    expect(f.at(-1).endOfOver).toMatchObject({ over: 1, runs: 9, wickets: 0, score: '9/0' });
    expect(f.at(-1).endOfOver.text).toBe('End of over 1: 9 runs. Alpha 9/0. CRR 9.00. Projected 27.');
  });

  it('reports the chase equation in the second innings', () => {
    const sim = new Sim(makeSetup({ oversPerInnings: 1 })).start();
    sim.ball(1).ball(1).ball(0).ball(0).ball(0).ball(0); // 2 all out of overs → target 3
    sim.start2().ball(1);
    expect(last(sim).scoreText).toBe('Bravo move to 1/0. Need 2 from 5 balls.');
  });

  it('marks milestones, the free hit, the shot and the end of the innings', () => {
    const sim = new Sim(makeSetup({ oversPerInnings: 2, maxOversPerBowler: 2 })).start();
    for (let i = 0; i < 6; i++) sim.six(); // A1 36*, over ends, A2 to face
    sim.setBowler('b2').ball(1); // A1 back on strike
    sim.six().six().six(); // 54
    expect(feed(sim).filter((e) => e.milestones.includes('FIFTY for A1!'))).toHaveLength(1);
    sim.noball(0);
    sim.ball(1, { shot: 'cover_drive' });
    expect(last(sim).text).toMatch(/1 run, driven through the covers\. \(free hit\)$/);
    sim.ball(0); // 12th legal ball: innings over
    expect(last(sim).milestones.at(-1)).toMatch(/^End of innings: Alpha 57\/0 \(2\.0 ov\)\.$/);
  });

  it('is deterministic and applies scorer edits without touching the score line', () => {
    const sim = new Sim(makeSetup()).start().four().ball(0);
    expect(feed(sim)).toEqual(feed(sim));
    const seq = feed(sim)[0].seq;
    const edited = feed(sim, new Map([[seq, 'Beautiful cover drive!']]))[0];
    expect(edited).toMatchObject({ text: 'Beautiful cover drive!', edited: true, score: '4/0', scoreText: 'Alpha move to 4/0.' });
    expect(edited.generated).toMatch(/FOUR!/);
  });

  it('rejects an unknown shot type but never requires one', () => {
    const sim = new Sim(makeSetup()).start();
    expect(() => sim.ball(1, { shot: 'helicopter' })).toThrow(/Unknown shot type/);
    sim.ball(1);
    expect(sim.inn.runs).toBe(1);
  });
});
