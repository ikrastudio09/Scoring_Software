// Points table and team statistics: DERIVED from confirmed match results.

import { Match, Team } from '../models/index.js';
import { getTournament } from './tournament.js';
import { bonusPointWinner, normalizeBonus } from '../engine/index.js';

let cache = null;
export function invalidatePoints() { cache = null; }

/** The team that earned a bonus point in this match, or null (rules.bonus off → never). */
function bonusTeam(m, rules) {
  const [first, second] = m.summary?.innings || [];
  return bonusPointWinner(first, second, m.result, rules.bonus);
}

/** Points each side took from one match: [[teamId, points], [teamId, points]]. */
function matchPoints(m, rules) {
  const type = m.result.type;
  if (type === 'win' || type === 'walkover') {
    const loser = m.result.winner === m.teamA ? m.teamB : m.teamA;
    const bonus = bonusTeam(m, rules) ? rules.bonus.points : 0;
    return [[m.result.winner, rules.win + bonus], [loser, rules.loss]];
  }
  const each = type === 'tie' ? rules.tie : rules.noResult;
  return [[m.teamA, each], [m.teamB, each]];
}

/**
 * Pure points-table computation (unit-tested separately).
 * matches: [{ teamA, teamB, result: {type, winner, superOver}, summary: {innings:[{team, runs, wickets, legalBalls, maxBalls, allOut}]}, ballsPerOver }]
 * rules.bonus (optional): { enabled, points, runsPercent, oversPercent }
 */
export function computeTable(teams, matches, rules) {
  const row = new Map(teams.map((t) => [t.id, {
    team: t, played: 0, won: 0, lost: 0, tied: 0, noResult: 0, bonus: 0, points: 0,
    runsFor: 0, oversFaced: 0, runsAgainst: 0, oversBowled: 0, nrr: 0, form: [],
  }]));
  for (const m of matches) {
    const a = row.get(m.teamA);
    const b = row.get(m.teamB);
    if (!a || !b) continue;
    const type = m.result.type;
    a.played += 1;
    b.played += 1;
    for (const [id, pts] of matchPoints(m, rules)) row.get(id).points += pts;
    if (type === 'win' || type === 'walkover') {
      const [w, l] = m.result.winner === m.teamA ? [a, b] : [b, a];
      w.won += 1; w.form.push('W');
      l.lost += 1; l.form.push('L');
      if (bonusTeam(m, rules)) w.bonus += 1;
    } else if (type === 'tie') {
      for (const r of [a, b]) { r.tied += 1; r.form.push('T'); }
    } else {
      for (const r of [a, b]) { r.noResult += 1; r.form.push('N'); }
    }
    // NRR counts only matches with a result decided on the field (wins and ties), and only the
    // two main innings: a Super Over never counts.
    if ((type === 'win' || type === 'tie') && m.summary?.innings?.length >= 2) {
      for (const inn of m.summary.innings.slice(0, 2)) {
        const bat = row.get(inn.team);
        const bowl = bat === a ? b : a;
        const balls = rules.nrrAllOutUsesFullQuota && inn.allOut ? inn.maxBalls : inn.legalBalls;
        const overs = balls / (m.ballsPerOver || 6);
        // True decimal overs (e.g. 9.4 overs = 9.667) so NRR is exact.
        bat.runsFor += inn.runs;
        bat.oversFaced += overs;
        bowl.runsAgainst += inn.runs;
        bowl.oversBowled += overs;
      }
    }
  }
  const rows = [...row.values()].map((r) => {
    const forRate = r.oversFaced ? r.runsFor / r.oversFaced : 0;
    const againstRate = r.oversBowled ? r.runsAgainst / r.oversBowled : 0;
    return {
      ...r,
      oversFaced: +r.oversFaced.toFixed(4),
      oversBowled: +r.oversBowled.toFixed(4),
      nrr: Math.round((forRate - againstRate) * 1000) / 1000,
      form: r.form.slice(-5),
    };
  });
  sortTable(rows, matches, rules);
  return rows.map((r, i) => ({ position: i + 1, ...r }));
}

/**
 * Points first, then the tournament's tie-breakers in order (default: NRR, wins, head-to-head),
 * then team name so the order is always deterministic.
 * headToHead = points earned in matches between the teams level on points (mini-league).
 */
export function sortTable(rows, matches, rules) {
  const order = rules.tiebreakers?.length ? rules.tiebreakers : ['nrr', 'wins', 'headToHead'];
  const h2h = new Map(); // points level → Map(teamId → points among the level group)
  const h2hPoints = (r) => {
    if (!h2h.has(r.points)) {
      const group = new Set(rows.filter((x) => x.points === r.points).map((x) => x.team.id));
      const pts = new Map([...group].map((id) => [id, 0]));
      for (const m of matches) {
        if (!group.has(m.teamA) || !group.has(m.teamB)) continue;
        for (const [id, p] of matchPoints(m, rules)) pts.set(id, pts.get(id) + p);
      }
      h2h.set(r.points, pts);
    }
    return h2h.get(r.points).get(r.team.id) ?? 0;
  };
  const by = { nrr: (x, y) => y.nrr - x.nrr, wins: (x, y) => y.won - x.won, headToHead: (x, y) => h2hPoints(y) - h2hPoints(x) };
  rows.sort((x, y) => {
    if (y.points !== x.points) return y.points - x.points;
    for (const k of order) {
      const d = by[k]?.(x, y);
      if (d) return d;
    }
    return x.team.name.localeCompare(y.team.name);
  });
  return rows;
}

async function confirmedMatches(stages) {
  const q = { 'result.confirmed': true };
  if (stages) q.stage = { $in: stages };
  const docs = await Match.find(q, 'teamA teamB result summary rules stage number scheduledAt').lean();
  return docs.map((m) => ({
    id: String(m._id),
    number: m.number,
    stage: m.stage,
    teamA: String(m.teamA),
    teamB: String(m.teamB),
    result: { type: m.result.type, winner: m.result.winner ? String(m.result.winner) : null, superOver: Boolean(m.result.superOver) },
    summary: m.summary,
    ballsPerOver: m.rules?.ballsPerOver || 6,
  }));
}

export async function getPointsTable() {
  if (cache) return cache;
  const t = await getTournament();
  const teams = (await Team.find({}, 'name shortName color logoUrl group').lean())
    .map((x) => ({ id: String(x._id), name: x.name, shortName: x.shortName, color: x.color, logoUrl: x.logoUrl, group: x.group || null }));
  const matches = await confirmedMatches(t.points.stages);
  const rules = { ...t.points, bonus: normalizeBonus(t.points.bonus) };
  const groups = [...new Set(teams.map((x) => x.group))].sort();
  const tables = groups.map((g) => ({
    group: g,
    rows: computeTable(teams.filter((x) => x.group === g), matches, rules),
  }));
  cache = {
    builtAt: new Date().toISOString(),
    rules: {
      win: t.points.win, loss: t.points.loss, tie: t.points.tie, noResult: t.points.noResult, stages: t.points.stages,
      nrrAllOutUsesFullQuota: t.points.nrrAllOutUsesFullQuota, bonus: rules.bonus, tiebreakers: t.points.tiebreakers?.length ? t.points.tiebreakers : ['nrr', 'wins', 'headToHead'],
    },
    groups: tables,
  };
  return cache;
}

/** Team record across all confirmed matches (all stages). */
export async function getTeamRecord(teamId) {
  const id = String(teamId);
  const matches = (await confirmedMatches(null)).filter((m) => m.teamA === id || m.teamB === id);
  const rec = { played: 0, won: 0, lost: 0, tied: 0, noResult: 0, runsScored: 0, runsConceded: 0, innings: 0, highest: null, lowest: null, recent: [] };
  for (const m of matches) {
    rec.played += 1;
    const type = m.result.type;
    if (type === 'win' || type === 'walkover') { if (m.result.winner === id) rec.won += 1; else rec.lost += 1; }
    else if (type === 'tie') rec.tied += 1;
    else rec.noResult += 1;
    for (const inn of m.summary?.innings || []) {
      if (inn.team === id) {
        rec.runsScored += inn.runs;
        rec.innings += 1;
        const score = { runs: inn.runs, wickets: inn.wickets, overs: inn.overs, match: m.id, matchNumber: m.number };
        if (!rec.highest || inn.runs > rec.highest.runs) rec.highest = score;
        // Lowest completed total: only count innings that ended (all out or full overs).
        if (inn.allOut || inn.legalBalls === inn.maxBalls) {
          if (!rec.lowest || inn.runs < rec.lowest.runs) rec.lowest = score;
        }
      } else {
        rec.runsConceded += inn.runs;
      }
    }
  }
  rec.averageScore = rec.innings ? Math.round((rec.runsScored / rec.innings) * 10) / 10 : null;
  rec.recent = matches.sort((a, b) => b.number - a.number).slice(0, 5).map((m) => ({
    match: m.id, number: m.number,
    outcome: m.result.type === 'win' || m.result.type === 'walkover' ? (m.result.winner === id ? 'W' : 'L') : m.result.type === 'tie' ? 'T' : 'N',
    opponent: m.teamA === id ? m.teamB : m.teamA,
    text: m.summary?.resultText || null,
  }));
  const table = await getPointsTable();
  const row = table.groups.flatMap((g) => g.rows).find((r) => r.team.id === id);
  rec.points = row?.points ?? 0;
  rec.nrr = row?.nrr ?? 0;
  rec.position = row?.position ?? null;
  return rec;
}
