// Statistics: DERIVED data. Built from the engine state of confirmed matches; rebuildable at any
// time. Failures here are logged and never propagate to scoring (spec §53–54).
// Everything is per category: careers, leaderboards and MVP tables only ever see the rows of one
// category, so Men's, Ladies and Kids figures can never be combined.

import {
  SOCKET_EVENTS, average, economy, formatOvers, performanceRates, strikeRate, totalsOf,
} from '@cricket/shared';
import { Match, Player, PlayerMatchStat, Team } from '../models/index.js';
import { extractPlayerStats, impactContext, mergeWeights, scoreImpact } from '../engine/index.js';
import { getRuntime } from './runtime.js';
import { categoryConfig, categoryOf } from './categories.js';
import { invalidatePoints } from './points.js';
import { personSeasons, resolveCareer, seasonTable } from './history.js';
import { publishTournament } from '../realtime/hub.js';
import { logger } from '../utils/logger.js';
import { metrics } from '../utils/metrics.js';

const cache = new Map(); // categoryId → built statistics

/** Drop the cached statistics of one category (or of all categories). */
export function invalidateStats(categoryId) {
  if (categoryId) cache.delete(String(categoryId)); else cache.clear();
}

/** Rebuild the per-player rows of one match. */
export async function rebuildMatchStats(matchId) {
  const rt = await getRuntime(matchId);
  await PlayerMatchStat.deleteMany({ match: rt.match._id });
  const m = rt.match;
  // Stats only for confirmed matches where cricket was actually played (no-result games with
  // play still count toward individual statistics, as is standard).
  if (!m.result?.confirmed || !rt.state || !rt.state.innings.length) return 0;
  const teams = [rt.setup.battingFirst, rt.setup.bowlingFirst];
  const ctx = impactContext(rt.state, rt.setup);
  const rows = extractPlayerStats(rt.state, rt.setup).map((r) => ({
    match: m._id,
    category: m.category,
    player: r.playerId,
    team: r.teamId,
    opponent: teams.find((t) => t !== r.teamId),
    stage: m.stage,
    matchNumber: m.number,
    matchDate: m.scheduledAt || m.startedAt,
    batting: r.batting,
    bowling: r.bowling,
    fielding: r.fielding,
    context: ctx[r.playerId],
    playerOfMatch: m.result.playerOfMatch ? String(m.result.playerOfMatch) === r.playerId : false,
    ballsPerOver: rt.setup.rules.ballsPerOver,
  }));
  if (rows.length) await PlayerMatchStat.insertMany(rows);
  return rows.length;
}

/** Called whenever a result is confirmed, reopened or abandoned. Never throws. */
export function onResultsChanged(matchId) {
  setImmediate(async () => {
    let category = null;
    try {
      category = await categoryOf((await getRuntime(matchId)).match);
      invalidatePoints(category._id);
      invalidateStats(category._id);
      await rebuildMatchStats(matchId);
      metrics.state.stats.rebuilds++;
      invalidateStats(category._id);
      // Clients refetch only when the update concerns the category they are showing.
      const scope = { matchId: String(matchId), category: category.key };
      publishTournament(SOCKET_EVENTS.POINTS_TABLE_UPDATED, scope);
      publishTournament(SOCKET_EVENTS.STATISTICS_UPDATED, scope);
    } catch (err) {
      if (!category) { invalidatePoints(); invalidateStats(); }
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
    photoUrl: p.photoUrl || null, soldPoints: p.auction?.status === 'sold' ? (p.auction.soldPoints ?? 0) : null,
    matches: 0, playerOfMatch: 0, mvpAwards: 0,
    batting: { innings: 0, runs: 0, balls: 0, outs: 0, notOuts: 0, fours: 0, sixes: 0, dots: 0, fifties: 0, hundreds: 0, thirties: 0, ducks: 0, highest: null },
    bowling: { innings: 0, legalBalls: 0, runs: 0, wickets: 0, maidens: 0, dots: 0, wides: 0, noBalls: 0, foursConceded: 0, sixesConceded: 0, threeWickets: 0, best: null },
    fielding: { catches: 0, runOuts: 0, stumpings: 0 },
    impact: { total: 0, batting: 0, bowling: 0, fielding: 0, context: 0 },
    bpo: 6,
  };
}

function addRow(c, r) {
  c.matches += 1;
  c.bpo = r.ballsPerOver || 6;
  if (r.playerOfMatch) c.playerOfMatch += 1;
  if (r.mvpRank === 1) c.mvpAwards += 1;
  if (r.impact) for (const k of Object.keys(c.impact)) c.impact[k] += r.impact[k];
  if (r.batting) {
    const b = r.batting;
    const s = c.batting;
    s.innings += 1;
    s.runs += b.runs;
    s.balls += b.balls;
    s.fours += b.fours;
    s.sixes += b.sixes;
    s.dots += b.dots || 0;
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
    s.foursConceded += b.foursConceded || 0;
    s.sixesConceded += b.sixesConceded || 0;
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

const pct = (n, d) => (d ? Math.round((n / d) * 1000) / 10 : null);
const r1 = (n) => Math.round(n * 10) / 10;

function finalize(c) {
  const b = c.batting;
  const w = c.bowling;
  b.average = average(b.runs, b.outs);
  b.strikeRate = strikeRate(b.runs, b.balls);
  b.dotPct = pct(b.dots, b.balls);
  b.boundaryPct = pct(b.fours + b.sixes, b.balls); // % of balls faced hit for 4 or 6
  w.dotPct = pct(w.dots, w.legalBalls);
  w.boundariesConceded = w.foursConceded + w.sixesConceded;
  for (const k of Object.keys(c.impact)) c.impact[k] = r1(c.impact[k]);
  c.impactPerMatch = c.matches ? r1(c.impact.total / c.matches) : 0;
  // Secondary analytics only - never used for ranking MVP.
  c.valuePer100k = c.soldPoints ? Math.round((c.impact.total / (c.soldPoints / 100000)) * 100) / 100 : null;
  b.highestText = b.highest ? `${b.highest.runs}${b.highest.out ? '' : '*'}` : '-';
  w.overs = formatOvers(w.legalBalls, c.bpo);
  w.economy = economy(w.runs, w.legalBalls, c.bpo);
  w.average = average(w.runs, w.wickets);
  w.strikeRate = w.wickets ? Math.round((w.legalBalls / w.wickets) * 100) / 100 : null;
  w.bestText = w.best ? `${w.best.wickets}/${w.best.runs}` : '-';
  return c;
}

/**
 * Competition ranking ("1, 1, 3"): `sorted` is in display order; a row whose ranking value equals
 * the previous row's shares its rank. Stops after `n` rows but keeps every row tied with the last
 * one shown, so a shared place is never cut off. Adds { rank, tied }.
 */
export function rankRows(sorted, value, n = Infinity) {
  const out = [];
  let rank = 0;
  for (let i = 0; i < sorted.length; i++) {
    if (i === 0 || value(sorted[i]) !== value(sorted[i - 1])) rank = i + 1;
    if (i >= n && rank !== out.at(-1)?.rank) break;
    out.push({ ...sorted[i], rank });
  }
  const count = new Map();
  for (const r of out) count.set(r.rank, (count.get(r.rank) || 0) + 1);
  return out.map((r) => ({ ...r, tied: count.get(r.rank) > 1 }));
}

/** Impact of every row with the current weights, and each match's MVP ranking. */
export function rankMatches(rows, weights) {
  const byMatch = new Map();
  for (const r of rows) {
    r.impact = scoreImpact(r, weights);
    const k = String(r.match);
    if (!byMatch.has(k)) byMatch.set(k, []);
    byMatch.get(k).push(r);
  }
  for (const list of byMatch.values()) {
    list.sort((a, b) => b.impact.total - a.impact.total || String(a.player).localeCompare(String(b.player)));
    list.forEach((r, i) => { r.mvpRank = i + 1; });
  }
  return byMatch;
}

async function build(category) {
  const scope = { category: category._id };
  const [rows, players, teams, cfg] = await Promise.all([
    PlayerMatchStat.find(scope).lean(),
    Player.find(scope, 'name team role photoUrl auction').lean(),
    Team.find(scope, 'name shortName color').lean(),
    categoryConfig(category),
  ]);
  const QUALIFY = cfg.leaderboards;
  const weights = mergeWeights(cfg.impactWeights);
  rankMatches(rows, weights);
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
  const line = (c) => ({
    playerId: c.playerId, name: c.name, team: c.team, teamInfo: teamMap[c.team], matches: c.matches, batting: c.batting, bowling: c.bowling,
    fielding: c.fielding, playerOfMatch: c.playerOfMatch, impact: c.impact, mvpAwards: c.mvpAwards,
  });
  // `value` is what the rank is decided on; ties on it share a rank (the sort only orders them).
  const top = (arr, filter, sort, value, n = 10) => rankRows(arr.filter(filter).sort(sort).map(line), value, n);
  const byName = (a, b) => a.name.localeCompare(b.name);
  const capOk = (c) => c.matches >= QUALIFY.capMinMatches;

  // Orange Cap: most runs. Tied on runs = joint holders (shown by strike rate, then name).
  const orange = rankRows(all.filter((c) => capOk(c) && c.batting.runs > 0)
    .sort((a, b) => b.batting.runs - a.batting.runs || (b.batting.strikeRate ?? 0) - (a.batting.strikeRate ?? 0) || byName(a, b))
    .map((c) => ({
      playerId: c.playerId, name: c.name, photoUrl: c.photoUrl, team: c.team, teamInfo: teamMap[c.team],
      runs: c.batting.runs, matches: c.matches, innings: c.batting.innings, average: c.batting.average,
      strikeRate: c.batting.strikeRate, fours: c.batting.fours, sixes: c.batting.sixes, highest: c.batting.highestText,
    })), (r) => r.runs);
  // Purple Cap: most wickets. Tied on wickets = joint holders (shown by economy, then name).
  const purple = rankRows(all.filter((c) => capOk(c) && c.bowling.wickets > 0)
    .sort((a, b) => b.bowling.wickets - a.bowling.wickets || (a.bowling.economy ?? 99) - (b.bowling.economy ?? 99) || byName(a, b))
    .map((c) => ({
      playerId: c.playerId, name: c.name, photoUrl: c.photoUrl, team: c.team, teamInfo: teamMap[c.team],
      wickets: c.bowling.wickets, matches: c.matches, overs: c.bowling.overs, economy: c.bowling.economy,
      average: c.bowling.average, strikeRate: c.bowling.strikeRate, best: c.bowling.bestText,
    })), (r) => r.wickets);
  const cap = (rows) => ({ holders: rows.filter((r) => r.rank === 1).map((r) => r.playerId), rows: rankRows(rows, (r) => r.rank, 10) });

  const built = {
    builtAt: new Date().toISOString(),
    category: { id: String(category._id), key: category.key, name: category.name },
    careers: new Map(all.map((c) => [c.playerId, c])),
    leaderboards: {
      orangeCap: cap(orange),
      purpleCap: cap(purple),
      mostRuns: top(all, (c) => c.batting.runs > 0, (a, b) => b.batting.runs - a.batting.runs || (b.batting.strikeRate ?? 0) - (a.batting.strikeRate ?? 0), (c) => c.batting.runs),
      mostWickets: top(all, (c) => c.bowling.wickets > 0, (a, b) => b.bowling.wickets - a.bowling.wickets || (a.bowling.economy ?? 99) - (b.bowling.economy ?? 99), (c) => c.bowling.wickets),
      highestScores: rankRows(innings.sort((a, b) => b.runs - a.runs || a.balls - b.balls).map(named), (x) => x.runs, 10),
      bestBowling: rankRows(spells.filter((x) => x.wickets > 0).sort((a, b) => b.wickets - a.wickets || a.runs - b.runs).map(named), (x) => `${x.wickets}/${x.runs}`, 10),
      bestStrikeRate: top(all, (c) => c.batting.balls >= QUALIFY.strikeRateMinBalls, (a, b) => b.batting.strikeRate - a.batting.strikeRate, (c) => c.batting.strikeRate),
      bestEconomy: top(all, (c) => c.bowling.legalBalls >= QUALIFY.economyMinBalls, (a, b) => a.bowling.economy - b.bowling.economy, (c) => c.bowling.economy),
      bestBattingAverage: top(all, (c) => c.batting.innings >= QUALIFY.averageMinInnings && c.batting.outs > 0, (a, b) => b.batting.average - a.batting.average, (c) => c.batting.average),
      mostFours: top(all, (c) => c.batting.fours > 0, (a, b) => b.batting.fours - a.batting.fours, (c) => c.batting.fours),
      mostSixes: top(all, (c) => c.batting.sixes > 0, (a, b) => b.batting.sixes - a.batting.sixes, (c) => c.batting.sixes),
      mostCatches: top(all, (c) => c.fielding.catches > 0, (a, b) => b.fielding.catches - a.fielding.catches, (c) => c.fielding.catches),
      // Fielding: every dismissal a fielder made (catches, run outs, stumpings).
      mostDismissals: top(all, (c) => fieldingTotal(c) > 0, (a, b) => fieldingTotal(b) - fieldingTotal(a) || b.fielding.catches - a.fielding.catches, fieldingTotal),
      mostDots: top(all, (c) => c.bowling.dots > 0, (a, b) => b.bowling.dots - a.bowling.dots, (c) => c.bowling.dots),
      mostPlayerOfMatch: top(all, (c) => c.playerOfMatch > 0, (a, b) => b.playerOfMatch - a.playerOfMatch, (c) => c.playerOfMatch),
      mostImpact: top(all, (c) => c.impact.total > 0, (a, b) => b.impact.total - a.impact.total, (c) => c.impact.total, 5),
    },
    caps: { orange, purple },
    // Tournament MVP table: every player who has played, ranked by total impact (ties share a rank).
    mvp: rankRows(all.filter((c) => c.matches > 0)
      .sort((a, b) => b.impact.total - a.impact.total || b.mvpAwards - a.mvpAwards || a.name.localeCompare(b.name))
      .map((c) => ({
        playerId: c.playerId, name: c.name, photoUrl: c.photoUrl, team: c.team, teamInfo: teamMap[c.team], matches: c.matches,
        impact: c.impact, impactPerMatch: c.impactPerMatch, mvpAwards: c.mvpAwards, playerOfMatch: c.playerOfMatch,
        runs: c.batting.runs, strikeRate: c.batting.strikeRate, wickets: c.bowling.wickets, economy: c.bowling.economy,
        fielding: c.fielding.catches + c.fielding.runOuts + c.fielding.stumpings,
        soldPoints: c.soldPoints, valuePer100k: c.valuePer100k,
      })), (r) => r.impact.total),
    weights,
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
  cache.set(String(category._id), built);
  return built;
}

/** The built statistics of one category (cached until a result in that category changes). */
async function statsFor(category) {
  return cache.get(String(category._id)) || build(category);
}

export async function getLeaderboards(category) {
  const c = await statsFor(category);
  return { builtAt: c.builtAt, category: c.category, qualify: c.qualify, totals: c.totals, ...c.leaderboards };
}

export const VALUE_MIN_MATCHES = 2;

/** Tournament MVP leaderboard + value-for-money (secondary analytics, never part of the ranking). */
export async function getMvpTable(category) {
  const c = await statsFor(category);
  const value = c.mvp
    .filter((r) => r.valuePer100k !== null && r.matches >= VALUE_MIN_MATCHES)
    .sort((a, b) => b.valuePer100k - a.valuePer100k)
    .slice(0, 20);
  return { builtAt: c.builtAt, category: c.category, weights: c.weights, players: c.mvp, valueForMoney: value, valueMinMatches: VALUE_MIN_MATCHES };
}

const fieldingTotal = (c) => c.fielding.catches + c.fielding.runOuts + c.fielding.stumpings;

/** This season's totals in the shape of a historical aggregate (packages/shared/src/performance.js). */
export function seasonPerformance(career) {
  if (!career?.matches) return null;
  const b = career.batting;
  const w = career.bowling;
  return {
    seasons: 1, matches: career.matches, innings: b.innings, runs: b.runs, ballsFaced: b.balls, notOuts: b.notOuts,
    fours: b.fours, sixes: b.sixes, wickets: w.wickets, ballsBowled: w.legalBalls, runsConceded: w.runs,
    catches: career.fielding.catches, runOuts: career.fielding.runOuts, stumpings: career.fielding.stumpings,
    playerOfMatch: career.playerOfMatch,
  };
}

/**
 * The three blocks a profile shows (this season, previous year, overall previous), kept apart; the
 * season-by-season table (imported / earlier scored seasons); and a career total that counts every
 * season once (services/history.js resolveCareer) and sums only fields every part supplies.
 * Public: no raw source text or import notes.
 */
export function playerHistory(player, career, season, ballsPerOver = 6, earlier = { imported: [], scored: [], otherCategories: [] }) {
  const block = (b, label) => (b ? {
    label, totals: totalsOf(b), rates: performanceRates(b, ballsPerOver), supplied: b.supplied || null,
  } : null);
  const h = player.history || {};
  const current = seasonPerformance(career);
  const prevSeason = h.previousYear?.meta?.season ?? season - 1;
  const resolved = resolveCareer({
    current: current ? { season, perf: current } : null,
    scored: earlier.scored,
    imported: earlier.imported,
    previousYear: h.previousYear ? { season: prevSeason, perf: h.previousYear } : null,
    overall: h.overallPrevious ? { toSeason: h.overallPrevious.meta?.toSeason ?? prevSeason - 1, perf: h.overallPrevious } : null,
  });
  const { totals, partial } = resolved;
  return {
    currentSeason: block(current, `Season ${season}`),
    previousYear: block(h.previousYear, `Season ${prevSeason}${h.previousYear?.meta?.label ? ` (${h.previousYear.meta.label})` : ''}`),
    overallPrevious: block(h.overallPrevious, `Before Season ${prevSeason}`),
    career: totals ? {
      label: 'Career', totals, rates: performanceRates(totals, ballsPerOver), partial, parts: resolved.parts.length, sources: resolved.parts, notes: resolved.notes,
    } : null,
    // Earlier seasons with their own records (imported files, or scored in this system).
    seasons: seasonTable([
      ...earlier.scored.map((x) => ({ ...x, source: 'scored' })),
      ...earlier.imported.map((x) => ({ ...x, source: 'imported' })),
    ], ballsPerOver),
    otherCategories: earlier.otherCategories,
  };
}

export async function getPlayerCareer(player) {
  const category = await categoryOf(player);
  const c = await statsFor(category);
  const playerId = player._id;
  const id = String(playerId);
  const career = c.careers.get(id);
  const matches = await PlayerMatchStat.find({ player: playerId }).sort({ matchNumber: 1 }).populate('opponent', 'name shortName').lean();
  const rank = c.mvp.find((r) => r.playerId === id)?.rank ?? null;
  const orange = c.caps.orange.find((r) => r.playerId === id);
  const purple = c.caps.purple.find((r) => r.playerId === id);
  return {
    awards: {
      orangeCap: orange?.rank === 1, orangeRank: orange?.rank ?? null,
      purpleCap: purple?.rank === 1, purpleRank: purple?.rank ?? null,
      mvpRank: rank, mvpAwards: career?.mvpAwards ?? 0, playerOfMatch: career?.playerOfMatch ?? 0,
    },
    history: playerHistory(player, career, category.season, career?.bpo || 6, await personSeasons(player, category)),
    career: career ? { ...career, mvpRank: rank } : null,
    matches: matches.map((r) => ({
      impact: scoreImpact(r, c.weights).total,
      match: String(r.match), matchNumber: r.matchNumber, date: r.matchDate,
      opponent: r.opponent ? { id: String(r.opponent._id), name: r.opponent.name, shortName: r.opponent.shortName } : null,
      batting: r.batting, bowling: r.bowling && { ...r.bowling, overs: formatOvers(r.bowling.legalBalls, r.ballsPerOver || 6) },
      fielding: r.fielding, playerOfMatch: r.playerOfMatch,
    })),
  };
}

/** Match MVP ranking from the authoritative state (live during the match, final once completed). */
export async function getMatchMvp(matchId, limit = 5) {
  const rt = await getRuntime(matchId);
  if (!rt.state || !rt.state.innings.length) return { matchId: rt.id, final: false, players: [] };
  const weights = mergeWeights((await categoryConfig(await categoryOf(rt.match))).impactWeights);
  const weightsKey = JSON.stringify(weights);
  const key = `mvp:${limit}`;
  const hit = rt.views[key];
  if (hit && hit.version === rt.lastSeq && hit.weights === weightsKey) return hit.value;
  const ctx = impactContext(rt.state, rt.setup);
  const ranked = extractPlayerStats(rt.state, rt.setup)
    .map((r) => ({ ...r, impact: scoreImpact({ ...r, context: ctx[r.playerId] }, weights) }))
    .sort((a, b) => b.impact.total - a.impact.total || a.playerId.localeCompare(b.playerId))
    .slice(0, limit);
  const bpo = rt.setup.rules.ballsPerOver;
  const value = {
    matchId: rt.id,
    final: rt.state.status === 'COMPLETED',
    players: ranked.map((r, i) => ({
      rank: i + 1,
      playerId: r.playerId,
      name: rt.meta.players[r.playerId]?.name,
      team: r.teamId,
      teamInfo: rt.meta.teams[r.teamId],
      impact: r.impact,
      batting: r.batting && { runs: r.batting.runs, balls: r.batting.balls, fours: r.batting.fours, sixes: r.batting.sixes, out: r.batting.out },
      bowling: r.bowling && { wickets: r.bowling.wickets, runs: r.bowling.runs, overs: formatOvers(r.bowling.legalBalls, bpo) },
      fielding: r.fielding,
    })),
  };
  rt.views[key] = { version: rt.lastSeq, weights: weightsKey, value };
  return value;
}

/** Team-level batting / bowling aggregates and the squad's leaders, from the cached careers. */
export async function getTeamStats(team) {
  const c = await statsFor(await categoryOf(team));
  const id = String(team._id);
  const squad = [...c.careers.values()].filter((p) => p.team === id && p.matches > 0);
  const sum = (f) => squad.reduce((s, p) => s + f(p), 0);
  const bpo = squad[0]?.bpo || 6;
  const balls = sum((p) => p.bowling.legalBalls);
  const brief = (p) => ({ playerId: p.playerId, name: p.name, photoUrl: p.photoUrl, matches: p.matches, runs: p.batting.runs, strikeRate: p.batting.strikeRate, wickets: p.bowling.wickets, economy: p.bowling.economy, impact: p.impact.total });
  return {
    batting: { runs: sum((p) => p.batting.runs), balls: sum((p) => p.batting.balls), fours: sum((p) => p.batting.fours), sixes: sum((p) => p.batting.sixes), fifties: sum((p) => p.batting.fifties + p.batting.hundreds) },
    bowling: { wickets: sum((p) => p.bowling.wickets), runs: sum((p) => p.bowling.runs), overs: formatOvers(balls, bpo), economy: economy(sum((p) => p.bowling.runs), balls, bpo), maidens: sum((p) => p.bowling.maidens), dots: sum((p) => p.bowling.dots) },
    fielding: { catches: sum((p) => p.fielding.catches), runOuts: sum((p) => p.fielding.runOuts), stumpings: sum((p) => p.fielding.stumpings) },
    topBatters: [...squad].sort((a, b) => b.batting.runs - a.batting.runs).slice(0, 3).filter((p) => p.batting.runs > 0).map(brief),
    topBowlers: [...squad].sort((a, b) => b.bowling.wickets - a.bowling.wickets || (a.bowling.economy ?? 99) - (b.bowling.economy ?? 99)).slice(0, 3).filter((p) => p.bowling.wickets > 0).map(brief),
    mvp: [...squad].sort((a, b) => b.impact.total - a.impact.total).slice(0, 3).map(brief),
  };
}
