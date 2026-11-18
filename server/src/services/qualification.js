// Qualification scenarios for one category: the real picture, and a what-if calculator.
// Hypothetical results are only ever computed in memory — they are never stored and never touch
// the real points table or statistics.

import { MATCH_STATUS } from '@cricket/shared';
import { Match } from '../models/index.js';
import { analyseQualification } from '../engine/qualification.js';
import { groupTables, tableInputs } from './points.js';
import { publicCategory } from './categories.js';
import { ttlCache } from '../utils/ttlCache.js';
import { badRequest } from '../utils/errors.js';

const cache = ttlCache(5000);

// status → [label, certainty]. certainty: guaranteed | nrr | possible
export const STATUS = {
  QUALIFIED: ['Qualified', 'guaranteed'],
  SECURED: ['Qualification secured', 'guaranteed'],
  ELIMINATED: ['Eliminated', 'guaranteed'],
  NRR_ONLY: ['Qualification depends on NRR', 'nrr'],
  NRR_DEPENDENT: ['Qualification depends on NRR', 'nrr'],
  MUST_WIN: ['Must win', 'possible'],
  WIN_AND_DEPEND: ['Win and depend on other results', 'possible'],
  IN_OWN_HANDS: ['In their own hands', 'possible'],
  IN_CONTENTION: ['In contention', 'possible'],
};

function explain(r, slots, opponent, final) {
  const top = `the top ${slots}`;
  switch (r.status) {
    case 'QUALIFIED': return `Finished in ${top}.`;
    case 'SECURED': return `Through to ${top} whatever happens in the remaining matches.`;
    case 'ELIMINATED':
      if (final) return `Finished outside ${top}.`;
      return r.remaining ? `Cannot reach ${top}, even by winning every remaining match.` : `No matches left, and other results can no longer lift them into ${top}.`;
    case 'NRR_ONLY': return `${r.remaining ? '' : 'No matches left. '}Can at best finish level on points with a team in ${top}: net run rate (or the next tie-breaker) would decide.`;
    case 'NRR_DEPENDENT': return `Can only miss out by finishing level on points with another team: net run rate (or the next tie-breaker) would decide.`;
    case 'MUST_WIN': return `Must win the next match${opponent ? ` against ${opponent}` : ''}: any other result ends their chances.${r.qualifiesIfWinsAll === false ? ' Even winning every match, other results must also go their way.' : ''}`;
    case 'WIN_AND_DEPEND': return 'Even winning every remaining match is not enough on its own: other results must also go their way.';
    case 'IN_OWN_HANDS': return `Winning their remaining matches guarantees a place in ${top}.`;
    default: return r.undetermined ? 'Still in contention. Too many result combinations remain to settle more yet.' : 'Still in contention.';
  }
}

/** League fixtures that still count toward the table and have both teams. */
async function openFixtures(category, stages) {
  const docs = await Match.find({
    category: category._id,
    stage: { $in: stages?.length ? stages : ['league'] },
    'result.confirmed': { $ne: true },
    status: { $ne: MATCH_STATUS.CANCELLED },
    teamA: { $ne: null },
    teamB: { $ne: null },
  }, 'number teamA teamB scheduledAt status rules').sort({ scheduledAt: 1, number: 1 }).lean();
  return docs.map((m) => ({
    id: String(m._id), number: m.number, teamA: String(m.teamA), teamB: String(m.teamB), status: m.status,
    scheduledAt: m.scheduledAt, ballsPerOver: m.rules?.ballsPerOver || 6, oversPerInnings: m.rules?.oversPerInnings,
  }));
}

function predict(tables, remaining, rules, slots, budget) {
  const name = (id) => tables.flatMap((g) => g.rows).find((r) => r.team.id === id)?.team;
  return tables.map((g) => {
    const teams = g.rows.map((r) => ({ id: r.team.id, points: r.points, position: r.position }));
    const ids = new Set(teams.map((t) => t.id));
    const fixtures = remaining.filter((m) => ids.has(m.teamA) || ids.has(m.teamB));
    const res = analyseQualification({ teams, remaining: fixtures, rules, slots, budget });
    const final = fixtures.length === 0;
    return {
      group: g.group,
      final,
      remainingMatches: fixtures.length,
      rows: g.rows.map((row) => {
        const r = res[row.team.id];
        const next = fixtures.find((m) => m.id === r.nextMatch);
        const oppId = next ? (next.teamA === row.team.id ? next.teamB : next.teamA) : null;
        const opp = oppId ? name(oppId) : null;
        const [label, certainty] = STATUS[r.status];
        return {
          position: row.position, team: row.team, played: row.played, won: row.won, lost: row.lost, points: row.points,
          nrr: row.nrr, remaining: r.remaining, minPoints: r.minPoints, maxPoints: r.maxPoints,
          status: r.status, label, certainty, text: explain(r, slots, opp?.name, final),
          nextMatch: next ? { id: next.id, number: next.number, opponent: opp } : null,
          undetermined: r.undetermined,
          combinations: r.combinations || null,
        };
      }),
    };
  });
}

function rulesOut(rules, slots) {
  return {
    slots, win: rules.win, loss: rules.loss, tie: rules.tie, noResult: rules.noResult,
    bonus: rules.bonus?.enabled ? { points: rules.bonus.points } : null, tiebreakers: rules.tiebreakers?.length ? rules.tiebreakers : ['nrr', 'wins', 'headToHead'],
  };
}

/** The real qualification picture of one category (cached briefly). */
export function getQualification(category) {
  return cache.get(String(category._id), async () => {
    const { cfg, teams, matches, rules } = await tableInputs(category);
    const slots = cfg.qualification.slots;
    const remaining = await openFixtures(category, rules.stages);
    return {
      builtAt: new Date().toISOString(),
      category: publicCategory(category),
      rules: rulesOut(rules, slots),
      groups: predict(groupTables(teams, matches, rules), remaining, rules, slots, 200000),
      remaining: remaining.map((m) => ({ id: m.id, number: m.number, teamA: m.teamA, teamB: m.teamB, scheduledAt: m.scheduledAt })),
    };
  });
}

const OVERS = /^(\d{1,2})(?:\.(\d))?$/;

/** A hypothetical score → summary innings, validated against the chosen result. */
function hypotheticalSummary(f, outcome, score, maxWickets) {
  const bpo = f.ballsPerOver;
  const maxBalls = (f.oversPerInnings || 20) * bpo;
  const side = (key) => {
    const s = score[key];
    const m = String(s?.overs ?? '').match(OVERS);
    if (!s || !Number.isInteger(s.runs) || s.runs < 0 || !Number.isInteger(s.wickets) || s.wickets < 0 || s.wickets > maxWickets || !m || Number(m[2] || 0) >= bpo) {
      throw badRequest(`Match ${f.number}: enter runs, wickets (0–${maxWickets}) and overs (like 9.4) for both teams`);
    }
    const legalBalls = Number(m[1]) * bpo + Number(m[2] || 0);
    if (legalBalls > maxBalls) throw badRequest(`Match ${f.number}: at most ${maxBalls / bpo} overs per innings`);
    return { team: key === 'teamA' ? f.teamA : f.teamB, runs: s.runs, wickets: s.wickets, legalBalls, maxBalls, allOut: s.wickets >= maxWickets };
  };
  const a = side('teamA');
  const b = side('teamB');
  const [first, second] = score.battedFirst === 'teamB' ? [b, a] : [a, b];
  const winner = outcome === 'A' ? f.teamA : outcome === 'B' ? f.teamB : null;
  if (outcome === 'T' && a.runs !== b.runs) throw badRequest(`Match ${f.number}: a tie needs equal scores`);
  if (winner && (winner === first.team ? first.runs <= second.runs : second.runs <= first.runs)) {
    throw badRequest(`Match ${f.number}: the winner must score more runs`);
  }
  if (winner === second.team && second.runs > first.runs + 6) throw badRequest(`Match ${f.number}: a chase ends once the target is passed`);
  if (winner === first.team && !second.allOut && second.legalBalls < maxBalls) {
    throw badRequest(`Match ${f.number}: the chasing side must be all out or use all its overs to lose`);
  }
  return { innings: [first, second] };
}

/**
 * results: [{ matchId, outcome: 'A'|'B'|'T'|'N', bonus?: boolean, score?: { battedFirst, teamA:{runs,wickets,overs}, teamB:{…} } }]
 * Returns the hypothetical tables + qualification picture. Nothing is written.
 */
export async function whatIf(category, results) {
  const { cfg, teams, matches, rules } = await tableInputs(category);
  const slots = cfg.qualification.slots;
  const remaining = await openFixtures(category, rules.stages);
  const byId = new Map(remaining.map((m) => [m.id, m]));
  const maxWickets = (cfg.rules.playersPerSide || 11) - 1;
  const seen = new Set();
  const hypothetical = [];
  const nrrMissing = [];
  for (const r of results) {
    const f = byId.get(r.matchId);
    if (!f) throw badRequest('Only matches that are still to be decided can be simulated');
    if (seen.has(r.matchId)) throw badRequest(`Match ${f.number} is listed twice`);
    seen.add(r.matchId);
    const winner = r.outcome === 'A' ? f.teamA : r.outcome === 'B' ? f.teamB : null;
    const m = {
      id: `what-if:${f.id}`, number: f.number, teamA: f.teamA, teamB: f.teamB, ballsPerOver: f.ballsPerOver,
      result: { type: winner ? 'win' : r.outcome === 'T' ? 'tie' : 'no_result', winner, superOver: false },
    };
    if (r.score && r.outcome !== 'N') {
      m.summary = hypotheticalSummary(f, r.outcome, r.score, maxWickets); // bonus follows from the score
    } else {
      m.bonusWinner = winner && r.bonus ? winner : null;
      if (r.outcome !== 'N') nrrMissing.push(f.number); // a win or tie without a score cannot move NRR
    }
    hypothetical.push(m);
  }
  const tables = groupTables(teams, [...matches, ...hypothetical], rules);
  const left = remaining.filter((m) => !seen.has(m.id));
  return {
    hypothetical: true,
    category: publicCategory(category),
    rules: rulesOut(rules, slots),
    simulated: hypothetical.length,
    // NRR shown includes only real results and simulated results that have a score.
    nrrExcludes: nrrMissing.sort((a, b) => a - b),
    groups: predict(tables, left, rules, slots, 100000),
  };
}
