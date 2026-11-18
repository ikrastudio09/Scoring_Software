// Historical MPL records: careers across seasons, team histories and a category's season list.
//
// THE RULE AGAINST DOUBLE COUNTING (resolveCareer): each season is counted once, from the most
// detailed source — scored ball by ball in this system > an imported season row > the auction's
// previous-year aggregate. The auction's "overall previous" aggregate (all seasons before the
// previous one) is used only when no season it covers has its own record; if season rows cover
// all of its seasons they are used instead; if they cover only some, the aggregate is used and
// those rows are shown but not added. A career never mixes categories.

import { PERFORMANCE_KEYS, combinePerformances, performanceRates, totalsOf } from '@cricket/shared';
import { Category, HistoricalPlayerSeason, HistoricalTeamSeason, Player, PlayerMatchStat } from '../models/index.js';
import { ttlCache } from '../utils/ttlCache.js';

const cache = ttlCache(60000);
/** Imports, undos and identity links change history: drop the cached views. */
export function invalidateHistory() { cache.clear(); }

/**
 * PURE. Which periods make up a career, without counting any season twice.
 * current / scored / imported: [{ season, perf }]; previousYear: { season, perf };
 * overall: { toSeason, perf }. Returns { parts, totals, partial, notes }.
 */
export function resolveCareer({ current = null, scored = [], imported = [], previousYear = null, overall = null }) {
  const notes = [];
  const bySeason = new Map();
  for (const s of scored) bySeason.set(s.season, { ...s, source: 'scored' });
  if (current) bySeason.set(current.season, { ...current, source: 'scored' });
  for (const s of imported) if (!bySeason.has(s.season)) bySeason.set(s.season, { ...s, source: 'imported' });
  if (previousYear?.perf) {
    if (bySeason.has(previousYear.season)) notes.push(`Season ${previousYear.season} is counted from its season record, not the auction figure.`);
    else bySeason.set(previousYear.season, { ...previousYear, source: 'auction' });
  }
  let parts = [...bySeason.values()];
  if (overall?.perf) {
    const covered = parts.filter((p) => p.season <= overall.toSeason);
    const seasonsInTotal = overall.perf.seasons;
    if (!covered.length) {
      parts.push({ ...overall, source: 'auction-total' });
    } else if (Number.isInteger(seasonsInTotal) && covered.length >= seasonsInTotal) {
      notes.push(`Seasons up to ${overall.toSeason} are counted from season records, not the auction total.`);
    } else {
      parts = parts.filter((p) => p.season > overall.toSeason);
      parts.push({ ...overall, source: 'auction-total' });
      notes.push(`Season records before season ${overall.toSeason + 1} cover only part of the auction total; the total is used and those rows are not added again.`);
    }
  }
  const { totals, partial } = combinePerformances(parts.map((p) => p.perf));
  return { parts: parts.map((p) => ({ season: p.season ?? null, toSeason: p.toSeason ?? null, source: p.source })), totals, partial, notes };
}

/** Season totals of scored matches (PlayerMatchStat rows of one season record). */
export function perfFromStatRows(rows) {
  if (!rows.length) return null;
  const p = Object.fromEntries(PERFORMANCE_KEYS.map((k) => [k, 0]));
  p.seasons = 1;
  for (const r of rows) {
    p.matches += 1;
    if (r.batting) { p.innings += 1; p.runs += r.batting.runs; p.ballsFaced += r.batting.balls; p.fours += r.batting.fours; p.sixes += r.batting.sixes; if (!r.batting.out) p.notOuts += 1; }
    if (r.bowling) { p.wickets += r.bowling.wickets; p.ballsBowled += r.bowling.legalBalls; p.runsConceded += r.bowling.runs; }
    p.catches += r.fielding?.catches || 0;
    p.runOuts += r.fielding?.runOuts || 0;
    p.stumpings += r.fielding?.stumpings || 0;
    if (r.playerOfMatch) p.playerOfMatch += 1;
  }
  return p;
}

/**
 * Earlier seasons of the person behind `player` in the same category: imported season rows and
 * any earlier season scored in this system. For the profile's season table and career.
 */
export async function personSeasons(player, category) {
  if (!player.identity) return { imported: [], scored: [], otherCategories: [] };
  const [rows, records] = await Promise.all([
    HistoricalPlayerSeason.find({ identity: player.identity }).sort({ season: -1 }).lean(),
    Player.find({ identity: player.identity, _id: { $ne: player._id } }, 'category team').populate('team', 'name').lean(),
  ]);
  const cats = new Map((await Category.find({ _id: { $in: records.map((r) => r.category) } }, 'season key name').lean()).map((c) => [String(c._id), c]));
  const earlier = records.filter((r) => cats.get(String(r.category))?.key === category.key && cats.get(String(r.category)).season < category.season);
  const stats = earlier.length ? await PlayerMatchStat.find({ player: { $in: earlier.map((r) => r._id) } }).lean() : [];
  const scored = earlier.map((r) => ({
    season: cats.get(String(r.category)).season, team: r.team?.name || null,
    perf: perfFromStatRows(stats.filter((s) => String(s.player) === String(r._id))),
  })).filter((x) => x.perf);
  const imported = rows.filter((r) => r.categoryKey === category.key)
    .map((r) => ({ season: r.season, team: r.teamName || null, perf: r.performance, mvpAward: Boolean(r.mvpAward) }));
  // Other categories are listed for information only, never added to this career.
  const otherCategories = rows.filter((r) => r.categoryKey !== category.key).map((r) => ({ season: r.season, categoryKey: r.categoryKey }));
  return { imported, scored, otherCategories };
}

/** Rows of the profile's season-by-season table, newest first. */
export function seasonTable(list, ballsPerOver = 6) {
  return [...list].sort((a, b) => b.season - a.season).map((x) => ({
    season: x.season, team: x.team || null, source: x.source, mvpAward: Boolean(x.mvpAward),
    totals: totalsOf(x.perf), rates: performanceRates(x.perf, ballsPerOver),
  }));
}

/** A franchise's history in one category: past seasons (imported) + summary. */
export async function teamHistory(team, category) {
  if (!team.identity) return null;
  const rows = await HistoricalTeamSeason.find({ teamIdentity: team.identity, categoryKey: category.key }).sort({ season: -1 }).lean();
  if (!rows.length) return null;
  const sum = (k) => rows.reduce((s, r) => s + (r[k] || 0), 0);
  const withMatches = rows.filter((r) => Number.isInteger(r.matches));
  const matches = withMatches.reduce((s, r) => s + r.matches, 0);
  const won = withMatches.reduce((s, r) => s + (r.won || 0), 0);
  const positions = rows.map((r) => r.position).filter(Number.isInteger);
  const highs = rows.map((r) => r.highestScore).filter(Number.isInteger);
  return {
    summary: {
      seasons: rows.length, titles: rows.filter((r) => r.champion).length, finals: rows.filter((r) => r.finalist).length,
      matches, won, lost: sum('lost'), tied: sum('tied'), noResult: sum('noResult'),
      winPct: matches ? Math.round((won / matches) * 1000) / 10 : null,
      bestFinish: positions.length ? Math.min(...positions) : null,
      highestScore: highs.length ? Math.max(...highs) : null,
    },
    seasons: rows.map((r) => ({
      season: r.season, name: r.name, matches: r.matches ?? null, won: r.won ?? null, lost: r.lost ?? null, tied: r.tied ?? null, noResult: r.noResult ?? null,
      points: r.points ?? null, nrr: r.nrr ?? null, highestScore: r.highestScore ?? null, position: r.position ?? null, champion: Boolean(r.champion), finalist: Boolean(r.finalist),
    })),
  };
}

const best = (list, value) => {
  const vals = list.map(value).filter((v) => v !== undefined && v !== null);
  if (!vals.length) return [];
  const top = Math.max(...vals);
  return list.filter((x) => value(x) === top);
};

/**
 * A category's previous seasons (champion, runner-up, top run scorer / wicket taker, highest total)
 * and all-time records from imported history. Lazily loaded by the Tournament Centre; cached.
 */
export function categoryHistory(category) {
  return cache.get(`cat:${category.key}`, async () => {
    const [players, teams] = await Promise.all([
      HistoricalPlayerSeason.find({ categoryKey: category.key }, 'identity name season teamName performance mvpAward').lean(),
      HistoricalTeamSeason.find({ categoryKey: category.key }, 'teamIdentity name season champion finalist highestScore matches won').lean(),
    ]);
    const seasons = [...new Set([...players.map((p) => p.season), ...teams.map((t) => t.season)])].sort((a, b) => b - a);
    const person = (p, value) => ({ identity: String(p.identity), name: p.name, team: p.teamName || null, value });
    const rows = seasons.map((s) => {
      const ps = players.filter((p) => p.season === s);
      const ts = teams.filter((t) => t.season === s);
      return {
        season: s,
        champion: ts.filter((t) => t.champion).map((t) => t.name),
        runnerUp: ts.filter((t) => t.finalist && !t.champion).map((t) => t.name),
        topRunScorer: best(ps, (p) => p.performance?.runs).map((p) => person(p, p.performance.runs)),
        topWicketTaker: best(ps, (p) => p.performance?.wickets).map((p) => person(p, p.performance.wickets)),
        mvp: ps.filter((p) => p.mvpAward).map((p) => person(p, null)),
        highestTotal: best(ts, (t) => t.highestScore).map((t) => ({ name: t.name, value: t.highestScore })),
        teams: ts.length || null,
      };
    });
    // All-time (imported seasons only; the current season is shown live next to it).
    const byPerson = new Map();
    for (const p of players) {
      const k = String(p.identity);
      if (!byPerson.has(k)) byPerson.set(k, { identity: k, name: p.name, parts: [], seasons: 0 });
      const x = byPerson.get(k);
      x.parts.push(p.performance);
      x.seasons += 1;
      x.name = p.name;
    }
    const careers = [...byPerson.values()].map((x) => ({ identity: x.identity, name: x.name, seasons: x.seasons, totals: combinePerformances(x.parts).totals || {} }));
    const top = (key) => careers.filter((c) => Number.isInteger(c.totals[key]) && c.totals[key] > 0)
      .sort((a, b) => b.totals[key] - a.totals[key] || a.name.localeCompare(b.name)).slice(0, 10)
      .map((c) => ({ identity: c.identity, name: c.name, seasons: c.seasons, value: c.totals[key] }));
    const titles = new Map();
    for (const t of teams.filter((x) => x.champion)) {
      const k = String(t.teamIdentity);
      titles.set(k, { name: t.name, value: (titles.get(k)?.value || 0) + 1 });
    }
    return {
      category: { key: category.key, name: category.name },
      seasons: rows,
      allTime: {
        mostRuns: top('runs'), mostWickets: top('wickets'), mostMatches: top('matches'), mostCatches: top('catches'),
        mostTitles: [...titles.values()].sort((a, b) => b.value - a.value || a.name.localeCompare(b.name)),
      },
      available: rows.length > 0,
    };
  });
}
