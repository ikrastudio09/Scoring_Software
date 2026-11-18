// Phase 4 engine review: rules fixed during the line-by-line audit.
import { describe, expect, it } from 'vitest';
import { ERROR_CODES as E } from '@cricket/shared';
import { Sim, expectScoringError } from './helpers.js';

describe('free hit that is called a wide', () => {
  // ICC playing conditions: on a free hit the striker can only be out as off a no-ball, even if
  // the free-hit delivery is itself a wide — so no stumping or hit wicket off it.
  it('the striker cannot be stumped or out hit wicket off a wide free hit', () => {
    const s = new Sim().start().noball();
    expect(s.inn.freeHit).toBe(true);
    expectScoringError(() => s.out('stumped', { extra: 'wide', fielderId: 'b11' }), E.INVALID_WICKET);
    expectScoringError(() => s.out('hit_wicket', { extra: 'wide' }), E.INVALID_WICKET);
    expect(s.inn.wickets).toBe(0);
  });

  it('run out is still possible off it, and the free hit carries over', () => {
    const s = new Sim().start().noball();
    s.out('run_out', { extra: 'wide', runs: 1, batterId: 'a2', fielderId: 'b3' });
    expect(s.inn.wickets).toBe(1);
    expect(s.inn.extras.wides).toBe(2); // penalty + the run completed
    expect(s.inn.freeHit).toBe(true);
  });

  it('once the free hit is over, stumping off a wide is possible again', () => {
    const s = new Sim().start().noball().ball(1);
    expect(s.inn.freeHit).toBe(false);
    s.out('stumped', { extra: 'wide', fielderId: 'b11' });
    expect(s.inn.wickets).toBe(1);
    expect(s.bowler('b1').wickets).toBe(1);
  });
});

describe('stumping records the wicketkeeper', () => {
  it('a stumping needs the keeper (or a substitute) so it reaches the fielding statistics', () => {
    const s = new Sim().start();
    expectScoringError(() => s.out('stumped'), E.INVALID_WICKET);
    s.out('stumped', { fielderId: 'b11' });
    expect(s.batter('a1').dismissal).toMatchObject({ type: 'stumped', bowler: 'b1', fielder: 'b11' });
  });

  it('a substitute keeper is accepted', () => {
    const s = new Sim().start().out('stumped', { substituteFielder: true });
    expect(s.batter('a1').dismissal).toMatchObject({ type: 'stumped', fielder: null, substituteFielder: true });
  });
});
