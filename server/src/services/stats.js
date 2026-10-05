// Statistics: DERIVED data. Built from the engine state of confirmed matches; rebuildable at any
// time. Failures here are logged and never propagate to scoring (spec §53–54).

import { SOCKET_EVENTS, average, economy, strikeRate, formatOvers } from '@cricket/shared';
import { Match, Player, PlayerMatchStat, Team } from '../models/index.js';
import { extractPlayerStats } from '../engine/index.js';
import { getRuntime } from './runtime.js';
import { invalidatePoints } from './points.js';
import { publishTournament } from '../realtime/hub.js';
import { logger } from '../utils/logger.js';
import { metrics } from '../utils/metrics.js';

// Qualification thresholds for rate-based leaderboards.
export const QUALIFY = { strikeRateMinBalls: 30, economyMinBalls: 24, averageMinInnings: 3 };

let cache = null;

export function invalidateStats() { cache = null; }

/** Rebuild the per-player rows of one match. */
export async function rebuildMatchStats(matchId) {
  const rt = await getRuntime(matchId);
  await PlayerMatchStat.deleteMany({ match: rt.match._id });
  const m = rt.match;
  // Stats only for confirmed matches where cricket was actually played (no-result games with
  // play still count toward individual statistics, as is standard).
  if (!m.result?.confirmed || !rt.state || !rt.state.innings.length) return 0;
  const teams = [rt.setup.battingFirst, rt.setup.bowlingFirst];
  const rows = extractPlayerStats(rt.state, rt.setup).map((r) => ({
    match: m._id,
    player: r.playerId,
    team: r.teamId,
    opponent: teams.find((t) => t !== r.teamId),
    stage: m.stage,
    matchNumber: m.number,
    matchDate: m.scheduledAt || m.startedAt,
    batting: r.batting,
    bowling: r.bowling,
    fielding: r.fielding,
    playerOfMatch: m.result.playerOfMatch ? String(m.result.playerOfMatch) === r.playerId : false,
    ballsPerOver: rt.setup.rules.ballsPerOver,
  }));
  if (rows.length) await PlayerMatchStat.insertMany(rows);
  return rows.length;
}

/** Called whenever a result is confirmed, reopened or abandoned. Never throws. */
export function onResultsChanged(matchId) {
  setImmediate(async () => {
    invalidatePoints();
    invalidateStats();
    try {
      await rebuildMatchStats(matchId);
      metrics.state.stats.rebuilds++;
      invalidateStats();
      publishTournament(SOCKET_EVENTS.POINTS_TABLE_UPDATED, { matchId: String(matchId) });
      publishTournament(SOCKET_EVENTS.STATISTICS_UPDATED, { matchId: String(matchId) });
    } catch (err) {
      metrics.state.stats.failures++;
      logger.error({ err, matchId: String(matchId) }, 'statistics rebuild failed (scoring unaffected; run stats:rebuild)');
    }
  });
}

export async function rebuildAllStats() {
  const matches = await Match.find({ 'result.confirmed': true }, '_id').lean();
  await PlayerMatchStat.deleteMany({});
  let rows = 0;
  for (const m of matches) rows += await rebuildMatchStats(m._id);
  invalidateStats();
  invalidatePoints();
  return { matches: matches.length, rows };
}

function emptyCareer(p) {
  return {
    playerId: String(p._id), name: p.name, team: p.team ? String(p.team) : null, role: p.role,
    matches: 0, playerOfMatch: 0,
    batting: { innings: 0, runs: 0, balls: 0, outs: 0, notOuts: 0, fours: 0, sixes: 0, fifties: 0, hundreds: 0, thirties: 0, ducks: 0, highest: null },
    bowling: { innings: 0, legalBalls: 0, runs: 0, wickets: 0, maidens: 0, dots: 0, wides: 0, noBalls: 0, threeWickets: 0, best: null },
    fielding: { catches: 0, runOuts: 0, stumpings: 0 },
    bpo: 6,
  };
}

function addRow(c, r) {
  c.matches += 1;
  c.bpo = r.ballsPerOver || 6;
  if (r.playerOfMatch) c.playerOfMatch += 1;
  if (r.batting) {
    const b = r.batting;
    const s = c.batting;
    s.innings += 1;
    s.runs += b.runs;
    s.balls += b.balls;
    s.fours += b.fours;
    s.sixes += b.sixes;
    if (b.out) s.outs += 1; else s.notOuts += 1;
    if (b.runs >= 100) s.hundreds += 1; else if (b.runs >= 50) s.fifties += 1; else if (b.runs >= 30) s.thirties += 1;
    if (b.out && b.runs === 0) s.ducks += 1;
    if (!s.highest || b.runs > s.highest.runs || (b.runs === s.highest.runs && !b.out && s.highest.out)) {
      s.highest = { runs: b.runs, balls: b.balls, out: b.out, match: String(r.match) };
    }
  }
  if (r.bowling) {
    const b = r.bowling;
    const s = c.bowling;
    s.innings += 1;
    s.legalBalls += b.legalBalls;
    s.runs += b.runs;
    s.wickets += b.wickets;
    s.maidens += b.maidens;
    s.dots += b.dots;
    s.wides += b.wides;
    s.noBalls += b.noBalls;
    if (b.wickets >= 3) s.threeWickets += 1;
    if (!s.best || b.wickets > s.best.wickets || (b.wickets === s.best.wickets && b.runs < s.best.runs)) {
      s.best = { wickets: b.wickets, runs: b.runs, match: String(r.match) };
    }
  }
  if (r.fielding) {
    c.fielding.catches += r.fielding.catches || 0;
    c.fielding.runOuts += r.fielding.runOuts || 0;
    c.fielding.stumpings += r.fielding.stumpings || 0;
  }
}

function finalize(c) {
  const b = c.batting;
  const w = c.bowling;
  b.average = average(b.runs, b.outs);
  b.strikeRate = strikeRate(b.runs, b.balls);
  b.highestText = b.highest ? `${b.highest.runs}${b.highest.out ? '' : '*'}` : '-';
  w.overs = formatOvers(w.legalBalls, c.bpo);
  w.economy = economy(w.runs, w.legalBalls, c.bpo);
  w.average = average(w.runs, w.wickets);
  w.strikeRate = w.wickets ? Math.round((w.legalBalls / w.wickets) * 100) / 100 : null;
  w.bestText = w.best ? `${w.best.wickets}/${w.best.runs}` : '-';
  return c;
}

async function build() {
  const [rows, players, teams] = await Promise.all([
    PlayerMatchStat.find({}).lean(),
    Player.find({}, 'name team role').lean(),
    Team.find({}, 'name shortName color').lean(),
  ]);
  const teamMap = Object.fromEntries(teams.map((t) => [String(t._id), { id: String(t._id), name: t.name, shortName: t.shortName, color: t.color }]));
  const careers = new Map(players.map((p) => [String(p._id), emptyCareer(p)]));
  const innings = [];
  const spells = [];
  for (const r of rows) {
    const id = String(r.player);
    if (!careers.has(id)) continue; // player deleted
    addRow(careers.get(id), r);
    const base = { playerId: id, team: String(r.team), opponent: r.opponent ? String(r.opponent) : null, match: String(r.match), matchNumber: r.matchNumber };
    if (r.batting) innings.push({ ...base, runs: r.batting.runs, balls: r.batting.balls, fours: r.batting.fours, sixes: r.batting.sixes, out: r.batting.out });
    if (r.bowling) spells.push({ ...base, wickets: r.bowling.wickets, runs: r.bowling.runs, overs: formatOvers(r.bowling.legalBalls, r.ballsPerOver || 6) });
  }
  const all = [...careers.values()].map(finalize);
  const named = (x) => ({ ...x, name: careers.get(x.playerId)?.name, teamInfo: teamMap[x.team] || teamMap[careers.get(x.playerId)?.team] });
  const line = (c) => ({ playerId: c.playerId, name: c.name, team: c.team, teamInfo: teamMap[c.team], matches: c.matches, batting: c.batting, bowling: c.bowling, fielding: c.fielding, playerOfMatch: c.playerOfMatch });
  const top = (arr, filter, sort, n = 10) => arr.filter(filter).sort(sort).slice(0, n).map(line);

  cache = {
    builtAt: new Date().toISOString(),
    careers: new Map(all.map((c) => [c.playerId, c])),
    leaderboards: {
      mostRuns: top(all, (c) => c.batting.runs > 0, (a, b) => b.batting.runs - a.batting.runs || (b.batting.strikeRate ?? 0) - (a.batting.strikeRate ?? 0)),
      mostWickets: top(all, (c) => c.bowling.wickets > 0, (a, b) => b.bowling.wickets - a.bowling.wickets || (a.bowling.economy ?? 99) - (b.bowling.economy ?? 99)),
      highestScores: innings.sort((a, b) => b.runs - a.runs || a.balls - b.balls).slice(0, 10).map(named),
      bestBowling: spells.filter((s) => s.wickets > 0).sort((a, b) => b.wickets - a.wickets || a.runs - b.runs).slice(0, 10).map(named),
      bestStrikeRate: top(all, (c) => c.batting.balls >= QUALIFY.strikeRateMinBalls, (a, b) => b.batting.strikeRate - a.batting.strikeRate),
      bestEconomy: top(all, (c) => c.bowling.legalBalls >= QUALIFY.economyMinBalls, (a, b) => a.bowling.economy - b.bowling.economy),
      bestBattingAverage: top(all, (c) => c.batting.innings >= QUALIFY.averageMinInnings && c.batting.outs > 0, (a, b) => b.batting.average - a.batting.average),
      mostFours: top(all, (c) => c.batting.fours > 0, (a, b) => b.batting.fours - a.batting.fours),
      mostSixes: top(all, (c) => c.batting.sixes > 0, (a, b) => b.batting.sixes - a.batting.sixes),
      mostCatches: top(all, (c) => c.fielding.catches > 0, (a, b) => b.fielding.catches - a.fielding.catches),
      mostDots: top(all, (c) => c.bowling.dots > 0, (a, b) => b.bowling.dots - a.bowling.dots),
      mostPlayerOfMatch: top(all, (c) => c.playerOfMatch > 0, (a, b) => b.playerOfMatch - a.playerOfMatch),
    },
    qualify: QUALIFY,
    totals: {
      matches: new Set(rows.map((r) => String(r.match))).size,
      runs: innings.reduce((s, i) => s + i.runs, 0),
      wickets: spells.reduce((s, i) => s + i.wickets, 0),
      fours: innings.reduce((s, i) => s + i.fours, 0),
      sixes: innings.reduce((s, i) => s + i.sixes, 0),
      fifties: all.reduce((s, c) => s + c.batting.fifties + c.batting.hundreds, 0),
    },
  };
  return cache;
}

export async function getLeaderboards() {
  const c = cache || await build();
  return { builtAt: c.builtAt, qualify: c.qualify, totals: c.totals, ...c.leaderboards };
}

export async function getPlayerCareer(playerId) {
  const c = cache || await build();
  const career = c.careers.get(String(playerId));
  const matches = await PlayerMatchStat.find({ player: playerId }).sort({ matchNumber: 1 }).populate('opponent', 'name shortName').lean();
  return {
    career: career || null,
    matches: matches.map((r) => ({
      match: String(r.match), matchNumber: r.matchNumber, date: r.matchDate,
      opponent: r.opponent ? { id: String(r.opponent._id), name: r.opponent.name, shortName: r.opponent.shortName } : null,
      batting: r.batting, bowling: r.bowling && { ...r.bowling, overs: formatOvers(r.bowling.legalBalls, r.ballsPerOver || 6) },
      fielding: r.fielding, playerOfMatch: r.playerOfMatch,
    })),
  };
}
