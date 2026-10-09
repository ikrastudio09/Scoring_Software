// Tournament-scale test: the 81-fixture dataset, every league match played ball-by-ball through
// the real scoring service (8- and 10-over matches), then points table, NRR and statistics are
// checked against an independent recomputation from the event log.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Match, MatchEvent, PlayerMatchStat } from '../../src/models/index.js';
import { importTournament } from '../../scripts/lib/importer.js';
import { playMatch } from '../../scripts/lib/simulate.js';
import { sampleTournament } from '../../scripts/seed.js';
import { buildSetup, resolveEffective } from '../../src/services/runtime.js';
import { replay, extractPlayerStats } from '../../src/engine/index.js';
import { rebuildAllStats } from '../../src/services/stats.js';
import { bootServer, sleep } from './harness.js';

let ctx;
beforeAll(async () => { ctx = await bootServer(); });
afterAll(async () => { await ctx?.close(); });

describe('full tournament', () => {
  it('imports 81 fixtures and plays all 78 league matches (8 and 10 overs)', { timeout: 600_000 }, async () => {
    const data = sampleTournament();
    await importTournament(data, { log: () => {} });
    expect(await Match.countDocuments()).toBe(81);

    const league = await Match.find({ stage: 'league' }).sort({ number: 1 }).lean();
    expect(league).toHaveLength(78);
    // Odd-numbered fixtures are 8-over matches, even are 10-over (per-match configuration).
    await Match.updateMany({ stage: 'league', number: { $mod: [2, 1] } }, { $set: { 'rules.oversPerInnings': 8 } });

    const t0 = performance.now();
    let commands = 0;
    for (const m of league) {
      const out = await playMatch(m._id, { seed: m.number });
      commands += out.commands;
      expect(out.view.state).toBe('COMPLETED');
    }
    const secs = (performance.now() - t0) / 1000;
    console.log(`played 78 matches, ${commands} scoring commands in ${secs.toFixed(1)}s (${((secs * 1000) / commands).toFixed(2)} ms/command incl. DB)`);
    await sleep(1500); // async stats rebuilds after each confirmation

    // ── overs configuration respected ──
    const done = await Match.find({ stage: 'league' }).lean();
    for (const m of done) {
      expect(m.status).toBe('COMPLETED');
      expect(m.result.confirmed).toBe(true);
      const maxBalls = (m.number % 2 ? 8 : 10) * 6;
      for (const inn of m.summary.innings) {
        expect(inn.maxBalls).toBe(maxBalls);
        expect(inn.legalBalls).toBeLessThanOrEqual(maxBalls);
      }
    }

    // ── points table vs independent computation ──
    const table = (await ctx.http.get('/api/points-table').expect(200)).body;
    const rows = table.groups.flatMap((g) => g.rows);
    expect(rows).toHaveLength(13);
    const totalPlayed = rows.reduce((s, r) => s + r.played, 0);
    expect(totalPlayed).toBe(78 * 2);
    const expected = new Map(rows.map((r) => [r.team.id, { won: 0, lost: 0, tied: 0, points: 0, rf: 0, of: 0, ra: 0, ob: 0 }]));
    for (const m of done) {
      const a = expected.get(String(m.teamA));
      const b = expected.get(String(m.teamB));
      if (m.result.type === 'tie') { a.tied++; b.tied++; a.points++; b.points++; } else {
        const w = String(m.result.winner) === String(m.teamA) ? a : b;
        const l = w === a ? b : a;
        w.won++; l.lost++; w.points += 2;
        // Bonus point (default rules): chase held below 75% of the target, or won within 75% of the overs.
        const [i1, i2] = m.summary.innings;
        const chased = String(m.result.winner) === i2.team;
        if (chased ? i2.legalBalls <= Math.floor(i2.maxBalls * 0.75) : i2.runs < (i1.runs + 1) * 0.75) w.points += 1;
      }
      for (const inn of m.summary.innings) {
        const bat = expected.get(inn.team);
        const bowl = bat === a ? b : a;
        const overs = (inn.allOut ? inn.maxBalls : inn.legalBalls) / 6;
        bat.rf += inn.runs; bat.of += overs; bowl.ra += inn.runs; bowl.ob += overs;
      }
    }
    for (const r of rows) {
      const e = expected.get(r.team.id);
      expect([r.won, r.lost, r.tied, r.points]).toEqual([e.won, e.lost, e.tied, e.points]);
      expect(r.nrr).toBeCloseTo(e.rf / e.of - e.ra / e.ob, 2);
    }
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i - 1].points > rows[i].points || (rows[i - 1].points === rows[i].points && rows[i - 1].nrr >= rows[i].nrr)).toBe(true);
    }

    // ── statistics are reproducible from the event log ──
    const lbBefore = (await ctx.http.get('/api/stats/leaderboards').expect(200)).body;
    expect(lbBefore.mostRuns.length).toBe(10);
    expect(lbBefore.mostWickets.length).toBe(10);
    expect(lbBefore.totals.matches).toBe(78);

    let totalRuns = 0;
    for (const m of done) {
      const events = await MatchEvent.find({ match: m._id }).sort({ seq: 1 }).lean();
      const state = replay(buildSetup(m), resolveEffective(events));
      totalRuns += extractPlayerStats(state, buildSetup(m)).reduce((s, r) => s + (r.batting?.runs || 0), 0);
    }
    expect(lbBefore.totals.runs).toBe(totalRuns);

    await rebuildAllStats();
    const lbAfter = (await ctx.http.get('/api/stats/leaderboards').expect(200)).body;
    const strip = ({ builtAt, ...x }) => x;
    expect(strip(lbAfter)).toEqual(strip(lbBefore));
    expect(await PlayerMatchStat.countDocuments()).toBe(78 * 22);

    // ── viewer endpoints at tournament scale ──
    const t1 = performance.now();
    const home = (await ctx.http.get('/api/home').expect(200)).body;
    const homeMs = performance.now() - t1;
    expect(home.recent).toHaveLength(6);
    expect(home.upcoming.length).toBeGreaterThan(0);
    const list = (await ctx.http.get('/api/matches').expect(200)).body.matches;
    expect(list).toHaveLength(81);
    console.log(`GET /api/home at 81 matches: ${homeMs.toFixed(1)} ms`);
  });
});
