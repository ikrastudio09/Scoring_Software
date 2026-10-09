// Derive per-player match statistics from a match state. Deterministic: the same events always
// produce the same rows, so tournament statistics can be rebuilt at any time.

/**
 * Returns one row per player in either playing XI:
 * { playerId, teamId, batting: {...}|null, bowling: {...}|null, fielding: {...} }
 */
export function extractPlayerStats(state, setup) {
  const rows = new Map();
  for (const team of [setup.battingFirst, setup.bowlingFirst]) {
    for (const playerId of setup.xi[team]) {
      rows.set(playerId, {
        playerId,
        teamId: team,
        batting: null,
        bowling: null,
        fielding: { catches: 0, runOuts: 0, stumpings: 0 },
      });
    }
  }

  // Super Overs decide a tie but never count toward player statistics (ICC).
  for (const inn of state.innings.filter((i) => !i.superOver)) {
    for (const id of inn.battingOrder) {
      const b = inn.batters[id];
      const row = rows.get(id);
      row.batting = {
        innings: inn.number,
        runs: b.runs,
        balls: b.balls,
        fours: b.fours,
        sixes: b.sixes,
        dots: b.dots,
        out: b.status === 'out',
        dismissal: b.dismissal?.type ?? null,
        position: b.position,
      };
      const d = b.dismissal;
      if (d && b.status === 'out') {
        if ((d.type === 'caught' || d.type === 'caught_and_bowled') && d.fielder) rows.get(d.fielder).fielding.catches += 1;
        if (d.type === 'run_out' && d.fielder) rows.get(d.fielder).fielding.runOuts += 1;
        if (d.type === 'stumped' && d.fielder) rows.get(d.fielder).fielding.stumpings += 1;
      }
    }
    for (const id of inn.bowlingOrder) {
      const b = inn.bowlers[id];
      if (b.legalBalls + b.wides + b.noBalls === 0) continue;
      rows.get(id).bowling = {
        innings: inn.number,
        legalBalls: b.legalBalls,
        runs: b.runs,
        wickets: b.wickets,
        maidens: b.maidens,
        dots: b.dots,
        wides: b.wides,
        noBalls: b.noBalls,
        foursConceded: b.fours,
        sixesConceded: b.sixes,
      };
    }
  }
  return [...rows.values()];
}

/** A simple, explainable Player-of-the-Match suggestion. The admin makes the final choice. */
export function suggestPlayerOfMatch(state, setup) {
  const rows = extractPlayerStats(state, setup);
  const winner = state.result?.winner;
  const score = (r) => {
    let s = 0;
    if (r.batting) s += r.batting.runs + r.batting.fours + 2 * r.batting.sixes + (r.batting.runs >= 50 ? 10 : 0);
    if (r.bowling) s += 22 * r.bowling.wickets + 8 * r.bowling.maidens + r.bowling.dots - Math.max(r.bowling.runs - r.bowling.legalBalls, 0) / 2;
    s += 8 * (r.fielding.catches + r.fielding.runOuts + r.fielding.stumpings);
    if (winner && r.teamId === winner) s *= 1.2;
    return s;
  };
  let best = null;
  for (const r of rows) {
    const s = score(r);
    if (!best || s > best.score) best = { playerId: r.playerId, score: Math.round(s * 10) / 10 };
  }
  return best;
}
