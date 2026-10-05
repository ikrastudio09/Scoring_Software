// Points table and team statistics: DERIVED from confirmed match results.

import { Match, Team } from '../models/index.js';
import { getTournament } from './tournament.js';

let cache = null;
export function invalidatePoints() { cache = null; }

/**
 * Pure points-table computation (unit-tested separately).
 * matches: [{ teamA, teamB, result: {type, winner}, summary: {innings:[{team, runs, wickets, legalBalls, maxBalls, allOut}]}, ballsPerOver }]
 */
export function computeTable(teams, matches, rules) {
  const row = new Map(teams.map((t) => [t.id, {
    team: t, played: 0, won: 0, lost: 0, tied: 0, noResult: 0, points: 0,
    runsFor: 0, oversFaced: 0, runsAgainst: 0, oversBowled: 0, nrr: 0, form: [],
  }]));
  for (const m of matches) {
    const a = row.get(m.teamA);
    const b = row.get(m.teamB);
    if (!a || !b) continue;
    const type = m.result.type;
    a.played += 1;
    b.played += 1;
    if (type === 'win' || type === 'walkover') {
      const [w, l] = m.result.winner === m.teamA ? [a, b] : [b, a];
      w.won += 1; w.points += rules.win; w.form.push('W');
      l.lost += 1; l.points += rules.loss; l.form.push('L');
    } else if (type === 'tie') {
      for (const r of [a, b]) { r.tied += 1; r.points += rules.tie; r.form.push('T'); }
    } else {
      for (const r of [a, b]) { r.noResult += 1; r.points += rules.noResult; r.form.push('N'); }
    }
    // NRR counts only matches with a result decided on the field (wins and ties).
    if ((type === 'win' || type === 'tie') && m.summary?.innings?.length === 2) {
      for (const inn of m.summary.innings) {
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
  rows.sort((x, y) => y.points - x.points || y.nrr - x.nrr || y.won - x.won || x.team.name.localeCompare(y.team.name));
  return rows.map((r, i) => ({ position: i + 1, ...r }));
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
    result: { type: m.result.type, winner: m.result.winner ? String(m.result.winner) : null },
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
  const groups = [...new Set(teams.map((x) => x.group))].sort();
  const tables = groups.map((g) => ({
    group: g,
    rows: computeTable(teams.filter((x) => x.group === g), matches, t.points),
  }));
  cache = {
    builtAt: new Date().toISOString(),
    rules: { win: t.points.win, loss: t.points.loss, tie: t.points.tie, noResult: t.points.noResult, stages: t.points.stages, nrrAllOutUsesFullQuota: t.points.nrrAllOutUsesFullQuota },
    groups: tables,
  };
  return cache;
}

/** Team record across all confirmed matches (all stages). */
export async function getTeamRecord(teamId) {
  const id = String(teamId);
  const matches = (await confirmedMatches(null)).filter((m) => m.teamA === id || m.teamB === id);
  const rec = { played: 0, won: 0, lost: 0, tied: 0, noResult: 0, runsScored: 0, runsConceded: 0, highest: null, lowest: null };
  for (const m of matches) {
    rec.played += 1;
    const type = m.result.type;
    if (type === 'win' || type === 'walkover') { if (m.result.winner === id) rec.won += 1; else rec.lost += 1; }
    else if (type === 'tie') rec.tied += 1;
    else rec.noResult += 1;
    for (const inn of m.summary?.innings || []) {
      if (inn.team === id) {
        rec.runsScored += inn.runs;
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
  return rec;
}
