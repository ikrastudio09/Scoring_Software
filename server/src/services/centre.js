// Tournament Centre: one category's overview, records, team records and leaderboards.
//
// Built from data that is already derived and cached per category — the statistics
// (services/stats.js), the points table (services/points.js) — plus one small query of the
// category's fixtures. Super Overs never count toward totals or records (as for statistics).
// Every "record" returns ALL holders when several are level.

import { MATCH_STATUS, formatOvers } from '@cricket/shared';
import { Match, Team } from '../models/index.js';
import { getLeaderboards, getMvpTable } from './stats.js';
import { getPointsTable } from './points.js';
import { publicCategory } from './categories.js';
import { ttlCache } from '../utils/ttlCache.js';

const cache = ttlCache(5000);

/** Every entry sharing the best value (empty when there is none). */
export function best(list, value, higherIsBetter = true) {
  const vals = list.map(value).filter((v) => v !== null && v !== undefined);
  if (!vals.length) return [];
  const top = higherIsBetter ? Math.max(...vals) : Math.min(...vals);
  return list.filter((x) => value(x) === top);
}

/**
 * Pure: team records from confirmed matches (oldest first).
 * matches: [{ id, number, teamA, teamB, result: {type, winner, marginRuns, marginWickets, ballsRemaining}, summary: {innings} }]
 */
export function teamRecords(matches, teamInfo) {
  const totals = [];
  const chases = [];
  const runWins = [];
  const wicketWins = [];
  const results = new Map(); // team → ['W', 'L', ...] in match order
  const push = (t, r) => { if (!results.has(t)) results.set(t, []); results.get(t).push(r); };
  for (const m of matches) {
    const inns = m.summary?.innings || [];
    for (const inn of inns) {
      totals.push({
        team: teamInfo(inn.team), runs: inn.runs, wickets: inn.wickets, overs: inn.overs, match: m.id, matchNumber: m.number,
        completed: inn.allOut || inn.legalBalls === inn.maxBalls,
      });
    }
    const r = m.result;
    if (r.type === 'win' || r.type === 'walkover') {
      push(r.winner, 'W');
      push(r.winner === m.teamA ? m.teamB : m.teamA, 'L');
    } else {
      push(m.teamA, r.type === 'tie' ? 'T' : 'N');
      push(m.teamB, r.type === 'tie' ? 'T' : 'N');
    }
    if (r.type !== 'win' || r.superOver || inns.length < 2) continue;
    const base = { winner: teamInfo(r.winner), loser: teamInfo(r.winner === m.teamA ? m.teamB : m.teamA), match: m.id, matchNumber: m.number };
    if (r.marginWickets !== undefined && r.marginWickets !== null) {
      chases.push({ ...base, runs: inns[1].runs, wickets: inns[1].wickets, overs: inns[1].overs, target: inns[0].runs + 1 });
      wicketWins.push({ ...base, wickets: r.marginWickets, ballsRemaining: r.ballsRemaining ?? 0 });
    } else if (r.marginRuns) {
      runWins.push({ ...base, runs: r.marginRuns });
    }
  }
  // Longest winning streak: consecutive wins; any other result (loss, tie, no result) ends it.
  const streaks = [...results].map(([team, list]) => {
    let run = 0;
    let longest = 0;
    for (const x of list) { run = x === 'W' ? run + 1 : 0; longest = Math.max(longest, run); }
    return { team: teamInfo(team), wins: longest, current: run };
  }).filter((s) => s.wins > 0);
  const completed = totals.filter((t) => t.completed);
  const widestWicketWin = best(wicketWins, (w) => w.wickets);
  return {
    highestTotal: best(totals, (t) => t.runs),
    lowestTotal: best(completed, (t) => t.runs, false),
    highestChase: best(chases, (c) => c.runs),
    biggestWinByRuns: best(runWins, (w) => w.runs),
    // Level on wickets: the one with more balls to spare is the bigger win.
    biggestWinByWickets: best(widestWicketWin, (w) => w.ballsRemaining),
    longestWinningStreak: best(streaks, (s) => s.wins),
  };
}

async function build(category) {
  const [fixtures, teams, lb, mvp, table] = await Promise.all([
    Match.find({ category: category._id }, 'number status stage teamA teamB result summary rules completedAt').sort({ number: 1 }).lean(),
    Team.find({ category: category._id }, 'name shortName color logoUrl').lean(),
    getLeaderboards(category),
    getMvpTable(category),
    getPointsTable(category),
  ]);
  const teamMap = new Map(teams.map((t) => [String(t._id), { id: String(t._id), name: t.name, shortName: t.shortName, color: t.color, logoUrl: t.logoUrl }]));
  const teamInfo = (id) => teamMap.get(String(id)) || { id: String(id), name: 'Unknown', shortName: '?' };
  const S = MATCH_STATUS;

  const confirmed = fixtures
    .filter((m) => m.result?.confirmed && m.result.type)
    .sort((a, b) => new Date(a.completedAt || 0) - new Date(b.completedAt || 0) || a.number - b.number)
    .map((m) => ({
      id: String(m._id), number: m.number, teamA: String(m.teamA), teamB: String(m.teamB), summary: m.summary, bpo: m.rules?.ballsPerOver || 6,
      result: {
        type: m.result.type, winner: m.result.winner ? String(m.result.winner) : null, superOver: Boolean(m.result.superOver),
        marginRuns: m.result.marginRuns ?? undefined, marginWickets: m.result.marginWickets ?? undefined, ballsRemaining: m.result.ballsRemaining ?? undefined,
      },
    }));

  // Overview: totals over the main innings of confirmed matches.
  let runs = 0;
  let wickets = 0;
  let legalBalls = 0;
  const bpo = confirmed[0]?.bpo || 6;
  for (const m of confirmed) {
    for (const inn of m.summary?.innings || []) { runs += inn.runs; wickets += inn.wickets; legalBalls += inn.legalBalls; }
  }
  const finished = (m) => [S.COMPLETED, S.ABANDONED].includes(m.status);
  const scheduled = fixtures.filter((m) => m.status !== S.CANCELLED);
  const top1 = (rows) => (rows || []).filter((r) => r.rank === 1);
  const rows = (list) => (list || []).flatMap((g) => g.rows);
  const tableRows = rows(table.groups);

  return {
    builtAt: new Date().toISOString(),
    category: publicCategory(category),
    overview: {
      totalMatches: scheduled.length,
      completed: scheduled.filter(finished).length,
      remaining: scheduled.filter((m) => !finished(m)).length,
      runs,
      wickets,
      fours: lb.totals.fours,
      sixes: lb.totals.sixes,
      // Every run that was not scored off the bat (statistics exclude Super Overs too).
      extras: Math.max(runs - lb.totals.runs, 0),
      overs: formatOvers(legalBalls, bpo),
      fifties: lb.totals.fifties,
    },
    records: {
      highestIndividualScore: top1(lb.highestScores),
      bestBowling: top1(lb.bestBowling),
      mostRuns: top1(lb.orangeCap?.rows),
      mostWickets: top1(lb.purpleCap?.rows),
      mostFours: top1(lb.mostFours),
      mostSixes: top1(lb.mostSixes),
      mostCatches: top1(lb.mostCatches),
      bestBattingAverage: top1(lb.bestBattingAverage),
      bestStrikeRate: top1(lb.bestStrikeRate),
      bestEconomy: top1(lb.bestEconomy),
      mostValuablePlayer: mvp.players.filter((p) => p.rank === 1),
    },
    teamRecords: {
      ...teamRecords(confirmed, teamInfo),
      mostWins: best(tableRows.filter((r) => r.won > 0), (r) => r.won).map((r) => ({ team: r.team, wins: r.won, played: r.played })),
      mostPoints: best(tableRows.filter((r) => r.played > 0), (r) => r.points).map((r) => ({ team: r.team, points: r.points, played: r.played })),
      bestNrr: best(tableRows.filter((r) => r.played > 0), (r) => r.nrr).map((r) => ({ team: r.team, nrr: r.nrr, played: r.played })),
    },
    leaderboards: {
      orangeCap: lb.orangeCap,
      purpleCap: lb.purpleCap,
      mvp: mvp.players.slice(0, 5),
      batting: lb.mostRuns.slice(0, 5),
      bowling: lb.mostWickets.slice(0, 5),
      fielding: lb.mostDismissals.slice(0, 5),
    },
    qualify: lb.qualify,
  };
}

/** The Tournament Centre of one category (cached briefly; everything it reads is cached too). */
export function getTournamentCentre(category) {
  return cache.get(String(category._id), () => build(category));
}
