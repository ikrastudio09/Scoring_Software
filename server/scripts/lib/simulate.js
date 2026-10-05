// Plays legal, realistic-looking matches through the REAL scoring service (same code path as the
// scorer console). Used by the dev seed, the 80-match tournament test and the load test.

import { randomUUID } from 'node:crypto';
import { Match, Player } from '../../src/models/index.js';
import { executeCommand } from '../../src/services/scoring.js';
import { setupMatch, confirmResult, playerOfMatchSuggestion } from '../../src/services/matches.js';
import { getRuntime, scorerView } from '../../src/services/runtime.js';

export function rng(seed = 42) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SYSTEM = { id: 'system', username: 'simulator' };

/** Toss + XIs from each team's first N active players. */
export async function autoSetup(matchId, r, xiSize = 11, user = SYSTEM) {
  const m = await Match.findById(matchId).lean();
  const [pa, pb] = await Promise.all([
    Player.find({ team: m.teamA, active: true }).sort({ _id: 1 }).limit(xiSize).lean(),
    Player.find({ team: m.teamB, active: true }).sort({ _id: 1 }).limit(xiSize).lean(),
  ]);
  return setupMatch(matchId, {
    toss: { winner: r() < 0.5 ? String(m.teamA) : String(m.teamB), decision: r() < 0.5 ? 'bat' : 'bowl' },
    playingXI: { teamA: pa.map((p) => String(p._id)), teamB: pb.map((p) => String(p._id)) },
  }, user);
}

/** Choose the next legal command for the current state. */
export function nextCommand(view, r) {
  const pick = (arr) => arr[Math.floor(r() * arr.length)];
  const s = view.scorer;
  if (view.needs?.startInnings || view.state === 'NOT_STARTED') {
    const [a, b] = s.battingXI;
    const bowler = s.bowlingXI[s.bowlingXI.length - 1 - Math.floor(r() * 5)];
    return { type: 'START_INNINGS', payload: { strikerId: a.id, nonStrikerId: b.id, bowlerId: bowler.id } };
  }
  if (view.needs?.batter) {
    if (!s.yetToBat.length) return { type: 'END_INNINGS', payload: { reason: 'no_batters' } };
    return { type: 'NEW_BATTER', payload: { batterId: s.yetToBat[0].id } };
  }
  if (view.needs?.bowler) {
    // Prefer bowlers from the bottom of the order (as real captains do).
    const avail = s.bowlers.filter((b) => b.available);
    const pool = avail.slice(-6).length ? avail.slice(-6) : avail;
    return { type: 'SET_BOWLER', payload: { bowlerId: pick(pool).id } };
  }
  const x = r();
  const cur = view.current;
  if (x < 0.035) return { type: 'DELIVERY', payload: { runs: 0, extra: 'wide' } };
  if (x < 0.05) return { type: 'DELIVERY', payload: { runs: r() < 0.7 ? 0 : 1, extra: 'noball' } };
  if (x < 0.06) return { type: 'DELIVERY', payload: { runs: 1, extra: r() < 0.5 ? 'bye' : 'legbye' } };
  if (x < 0.115) {
    const type = pick(['bowled', 'caught', 'caught', 'caught', 'lbw', 'run_out', 'stumped']);
    const fielder = pick(s.bowlingXI).id;
    if (cur.freeHit && type !== 'run_out') return { type: 'DELIVERY', payload: { runs: 1 } };
    const wicket = { type };
    if (type === 'caught' || type === 'stumped') wicket.fielderId = fielder;
    if (type === 'run_out') { wicket.batterId = r() < 0.6 ? cur.striker.id : cur.nonStriker.id; wicket.fielderId = fielder; }
    return { type: 'DELIVERY', payload: { runs: type === 'run_out' ? Math.floor(r() * 2) : 0, wicket } };
  }
  const runs = pick([0, 0, 0, 0, 1, 1, 1, 1, 1, 2, 2, 3, 4, 4, 6]);
  return { type: 'DELIVERY', payload: { runs, boundary: runs === 4 || runs === 6 ? r() < 0.9 : undefined } };
}

/** Play a match to completion. Returns the final scorer view. */
export async function playMatch(matchId, { seed = 1, confirm = true, user = SYSTEM, stopAfter = Infinity } = {}) {
  const r = rng(seed);
  let rt = await getRuntime(matchId);
  if (!rt.setup) {
    await autoSetup(matchId, r);
    rt = await getRuntime(matchId);
  }
  let view = scorerView(rt);
  let n = 0;
  while (view.state !== 'COMPLETED' && n < stopAfter) {
    const cmd = nextCommand(view, r);
    const out = await executeCommand(matchId, { ...cmd, clientEventId: randomUUID(), expectedVersion: view.version }, user);
    view = out.view;
    n++;
  }
  if (confirm && view.state === 'COMPLETED' && !view.match.resultConfirmed) {
    const potm = await playerOfMatchSuggestion(matchId);
    await confirmResult(matchId, { playerOfMatch: potm?.playerId }, user);
  }
  return { view, commands: n };
}
