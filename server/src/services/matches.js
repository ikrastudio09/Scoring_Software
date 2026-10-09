// Match lifecycle: fixtures, setup (toss + XIs), non-scoring status changes, result confirmation.

import mongoose from 'mongoose';
import { ERROR_CODES, MATCH_STATUS, SOCKET_EVENTS } from '@cricket/shared';
import { Match, MatchEvent, Player, Team } from '../models/index.js';
import { AppError, badRequest, conflict, notFound } from '../utils/errors.js';
import { getTournament } from './tournament.js';
import { audit } from './audit.js';
import { getRuntime, invalidateRuntime, withMatchLock } from './runtime.js';
import { publishStatusChange, publishTournament } from '../realtime/hub.js';
import { getMatchMvp, onResultsChanged } from './stats.js';
import { invalidateActiveMatch } from './active.js';

const S = MATCH_STATUS;
const TEAM_FIELDS = 'name shortName color logoUrl group';

export const matchPopulate = [
  { path: 'teamA', select: TEAM_FIELDS },
  { path: 'teamB', select: TEAM_FIELDS },
];

export function serializeMatch(m) {
  if (!m) return m;
  const team = (t, label) => (t && typeof t === 'object' && t.name
    ? { id: String(t._id), name: t.name, shortName: t.shortName, color: t.color, logoUrl: t.logoUrl, group: t.group }
    : t ? { id: String(t) } : label ? { id: null, name: label, shortName: 'TBD' } : null);
  return {
    id: String(m._id),
    number: m.number,
    stage: m.stage,
    group: m.group,
    teamA: team(m.teamA, m.teamALabel),
    teamB: team(m.teamB, m.teamBLabel),
    teamALabel: m.teamALabel,
    teamBLabel: m.teamBLabel,
    venue: m.venue,
    scheduledAt: m.scheduledAt,
    status: m.status,
    statusNote: m.statusNote,
    rules: m.rules,
    toss: m.toss?.winner ? { winner: String(m.toss.winner), decision: m.toss.decision } : null,
    playingXI: {
      teamA: (m.playingXI?.teamA || []).map((p) => (p?.name ? { id: String(p._id), name: p.name, role: p.role } : String(p))),
      teamB: (m.playingXI?.teamB || []).map((p) => (p?.name ? { id: String(p._id), name: p.name, role: p.role } : String(p))),
    },
    stateVersion: m.stateVersion,
    summary: m.summary,
    result: m.result?.type ? {
      type: m.result.type,
      winner: m.result.winner ? String(m.result.winner) : null,
      text: m.result.text,
      marginRuns: m.result.marginRuns ?? undefined,
      marginWickets: m.result.marginWickets ?? undefined,
      superOver: Boolean(m.result.superOver),
      confirmed: Boolean(m.result.confirmed),
      confirmedAt: m.result.confirmedAt,
      playerOfMatch: m.result.playerOfMatch?.name
        ? { id: String(m.result.playerOfMatch._id), name: m.result.playerOfMatch.name }
        : m.result.playerOfMatch ? { id: String(m.result.playerOfMatch) } : null,
    } : null,
    startedAt: m.startedAt,
    completedAt: m.completedAt,
  };
}

export async function listMatches(filter = {}) {
  const q = {};
  if (filter.status) q.status = { $in: String(filter.status).split(',') };
  if (filter.stage) q.stage = filter.stage;
  if (filter.team) q.$or = [{ teamA: filter.team }, { teamB: filter.team }];
  const docs = await Match.find(q)
    .select('-playingXI')
    .populate(matchPopulate)
    .populate({ path: 'result.playerOfMatch', select: 'name' })
    .sort({ scheduledAt: 1, number: 1 })
    .lean();
  return docs.map(serializeMatch);
}

export async function getMatch(id) {
  if (!mongoose.isValidObjectId(id)) throw notFound('Match');
  const m = await Match.findById(id)
    .populate(matchPopulate)
    .populate({ path: 'playingXI.teamA', select: 'name role' })
    .populate({ path: 'playingXI.teamB', select: 'name role' })
    .populate({ path: 'result.playerOfMatch', select: 'name' })
    .lean();
  if (!m) throw notFound('Match');
  return serializeMatch(m);
}

async function hasEvents(matchId) {
  return Boolean(await MatchEvent.exists({ match: matchId }));
}

async function assertTeams(teamA, teamB) {
  if (teamA && teamB && String(teamA) === String(teamB)) throw badRequest('A team cannot play itself');
  const ids = [teamA, teamB].filter(Boolean);
  if (ids.length && (await Team.countDocuments({ _id: { $in: ids } })) !== ids.length) throw badRequest('Unknown team');
}

export async function createMatch(data, user) {
  const t = await getTournament();
  await assertTeams(data.teamA, data.teamB);
  const number = data.number ?? ((await Match.findOne({}, 'number').sort({ number: -1 }).lean())?.number ?? 0) + 1;
  const { playersPerSide, ...ruleDefaults } = t.rules;
  const doc = await Match.create({
    ...data,
    number,
    rules: { ...ruleDefaults, ...(data.rules || {}) },
    status: S.SCHEDULED,
  });
  await audit(user, 'match.create', 'match', doc._id, { number });
  publishTournament(SOCKET_EVENTS.MATCH_STATUS_CHANGED, { matchId: String(doc._id), status: doc.status });
  return getMatch(doc._id);
}

const ALWAYS_EDITABLE = ['scheduledAt', 'venue', 'stage', 'group', 'teamALabel', 'teamBLabel', 'statusNote'];

export async function updateMatch(id, data, user) {
  return withMatchLock(id, async () => {
    const m = await Match.findById(id);
    if (!m) throw notFound('Match');
    const started = await hasEvents(m._id);
    const set = {};
    for (const k of ALWAYS_EDITABLE) if (data[k] !== undefined) set[k] = data[k];
    // League vs knockout decides whether a tie goes to a Super Over, so it is part of the
    // scoring rules once play has started.
    const isLeague = (stage) => (stage || 'league') === 'league';
    if (started && data.stage !== undefined && isLeague(data.stage) !== isLeague(m.stage)) {
      throw conflict('After scoring has started a match cannot move between the league and a knockout stage', ERROR_CODES.INVALID_TRANSITION);
    }
    if (data.number !== undefined) set.number = data.number;
    const structural = ['teamA', 'teamB', 'rules'].filter((k) => data[k] !== undefined);
    if (structural.length) {
      if (started) throw conflict('Teams and rules cannot change after scoring has started', ERROR_CODES.INVALID_TRANSITION);
      await assertTeams(data.teamA ?? m.teamA, data.teamB ?? m.teamB);
      if (data.rules) set.rules = { ...m.rules.toObject(), ...data.rules };
      for (const k of ['teamA', 'teamB']) {
        if (data[k] !== undefined && String(data[k]) !== String(m[k])) {
          set[k] = data[k];
          // Changing a team invalidates the toss and both XIs.
          set.toss = {};
          set.playingXI = { teamA: [], teamB: [] };
          if (m.status === S.READY) set.status = S.SCHEDULED;
        }
      }
    }
    await Match.updateOne({ _id: m._id }, { $set: set }, { runValidators: true });
    invalidateRuntime(id);
    await audit(user, 'match.update', 'match', id, set);
    return getMatch(id);
  });
}

export async function deleteMatch(id, user) {
  return withMatchLock(id, async () => {
    const m = await Match.findById(id);
    if (!m) throw notFound('Match');
    if (await hasEvents(m._id)) throw conflict('A match with scoring events cannot be deleted', ERROR_CODES.INVALID_TRANSITION);
    await m.deleteOne();
    invalidateRuntime(id);
    invalidateActiveMatch();
    await audit(user, 'match.delete', 'match', id, { number: m.number });
    publishTournament(SOCKET_EVENTS.MATCH_STATUS_CHANGED, { matchId: String(id), status: 'DELETED' });
  });
}

/** Toss and playing XIs. Allowed until the first scoring event. */
export async function setupMatch(id, { toss, playingXI }, user) {
  const t = await getTournament();
  return withMatchLock(id, async () => {
    const m = await Match.findById(id);
    if (!m) throw notFound('Match');
    if (![S.SCHEDULED, S.READY].includes(m.status)) {
      throw conflict(`Cannot set up a match that is ${m.status.toLowerCase()}`, ERROR_CODES.INVALID_TRANSITION);
    }
    if (await hasEvents(m._id)) throw conflict('Scoring has started; setup is locked', ERROR_CODES.INVALID_TRANSITION);
    if (!m.teamA || !m.teamB) throw badRequest('Both teams must be assigned first');

    const teams = [String(m.teamA), String(m.teamB)];
    if (!teams.includes(String(toss.winner))) throw badRequest('Toss winner must be one of the two teams');

    const max = t.rules.playersPerSide;
    for (const [side, teamId] of [['teamA', m.teamA], ['teamB', m.teamB]]) {
      const ids = playingXI[side].map(String);
      if (new Set(ids).size !== ids.length) throw badRequest(`Duplicate player in ${side} XI`);
      if (ids.length < 2 || ids.length > max) throw badRequest(`${side} XI must have between 2 and ${max} players`);
      const count = await Player.countDocuments({ _id: { $in: ids }, team: teamId });
      if (count !== ids.length) throw badRequest(`Every ${side} XI player must belong to that team`);
    }

    await Match.updateOne({ _id: m._id }, {
      $set: { toss, playingXI, status: S.READY },
    });
    invalidateRuntime(id);
    await audit(user, 'match.setup', 'match', id, { toss, xiSizes: [playingXI.teamA.length, playingXI.teamB.length] });
    const rt = await getRuntime(id);
    publishStatusChange(rt);
    return getMatch(id);
  });
}

// Status changes that do not involve scoring. In-play matches end through the CONCLUDE command.
const TRANSITIONS = {
  [S.SCHEDULED]: [S.POSTPONED, S.CANCELLED, S.ABANDONED],
  [S.READY]: [S.SCHEDULED, S.POSTPONED, S.CANCELLED, S.ABANDONED],
  [S.POSTPONED]: [S.SCHEDULED, S.CANCELLED],
  [S.CANCELLED]: [S.SCHEDULED],
  [S.ABANDONED]: [S.SCHEDULED],
};

export async function changeStatus(id, { status, note }, user) {
  const changed = await withMatchLock(id, async () => {
    const m = await Match.findById(id);
    if (!m) throw notFound('Match');
    if (!(TRANSITIONS[m.status] || []).includes(status)) {
      throw conflict(`Cannot change a ${m.status.toLowerCase()} match to ${status.toLowerCase()}`, ERROR_CODES.INVALID_TRANSITION);
    }
    if (await hasEvents(m._id)) {
      throw conflict('Scoring has started: use "Conclude match" (no result) or undo instead', ERROR_CODES.INVALID_TRANSITION);
    }
    const set = { status, statusNote: note || undefined };
    if (status === S.ABANDONED) {
      Object.assign(set, {
        'result.type': 'abandoned', 'result.text': 'Match abandoned', 'result.winner': null, 'result.loser': null,
        'result.confirmed': true, 'result.confirmedAt': new Date(), 'result.confirmedBy': user?.username,
        completedAt: new Date(),
      });
    } else if (m.status === S.ABANDONED) {
      Object.assign(set, { result: { confirmed: false }, completedAt: null });
    }
    if (status === S.SCHEDULED && m.status === S.READY) {
      Object.assign(set, { toss: {}, playingXI: { teamA: [], teamB: [] } });
    }
    await Match.updateOne({ _id: m._id }, { $set: set });
    invalidateRuntime(id);
    invalidateActiveMatch();
    await audit(user, 'match.status', 'match', id, { from: m.status, to: status, note });
    return { from: m.status, to: status };
  });
  const rt = await getRuntime(id);
  publishStatusChange(rt);
  if (changed.to === S.ABANDONED || changed.from === S.ABANDONED) onResultsChanged(id);
  return getMatch(id);
}

export async function confirmResult(id, { playerOfMatch }, user) {
  await withMatchLock(id, async () => {
    const rt = await getRuntime(id);
    const m = rt.match;
    if (![S.COMPLETED, S.ABANDONED].includes(m.status) || !m.result?.type) {
      throw conflict('Only a completed match can be confirmed', ERROR_CODES.INVALID_TRANSITION);
    }
    if (m.result.confirmed) throw conflict('Result is already confirmed');
    if (playerOfMatch) {
      const all = [...rt.setup.xi[rt.setup.battingFirst], ...rt.setup.xi[rt.setup.bowlingFirst]];
      if (!all.includes(String(playerOfMatch))) throw badRequest('Player of the match must be in one of the XIs');
    }
    const confirmedAt = new Date();
    await Match.updateOne({ _id: m._id }, {
      $set: {
        'result.confirmed': true, 'result.confirmedAt': confirmedAt, 'result.confirmedBy': user?.username,
        'result.playerOfMatch': playerOfMatch || null,
      },
    });
    rt.match = { ...m, result: { ...m.result, confirmed: true, confirmedAt, confirmedBy: user?.username, playerOfMatch: playerOfMatch || null } };
    rt.views = {};
    invalidateActiveMatch();
    await audit(user, 'match.confirm', 'match', id, { result: m.result.text, playerOfMatch });
  });
  const rt = await getRuntime(id);
  publishStatusChange(rt);
  onResultsChanged(id);
  return getMatch(id);
}

export async function reopenMatch(id, { reason }, user) {
  await withMatchLock(id, async () => {
    const rt = await getRuntime(id);
    if (!rt.match.result?.confirmed) throw conflict('Match is not confirmed');
    if (rt.match.status === S.ABANDONED && !rt.lastSeq) {
      throw conflict('Use the status control to reschedule an abandoned match', ERROR_CODES.INVALID_TRANSITION);
    }
    await Match.updateOne({ _id: rt.match._id }, { $set: { 'result.confirmed': false, 'result.confirmedAt': null } });
    rt.match = { ...rt.match, result: { ...rt.match.result, confirmed: false, confirmedAt: null } };
    rt.views = {};
    invalidateActiveMatch();
    await audit(user, 'match.reopen', 'match', id, { reason });
  });
  const rt = await getRuntime(id);
  publishStatusChange(rt);
  onResultsChanged(id);
  return getMatch(id);
}

/** The match MVP #1 (same impact formula as the MVP rankings, so the two always agree). */
export async function playerOfMatchSuggestion(id) {
  const rt = await getRuntime(id);
  if (!rt.state || rt.state.status !== 'COMPLETED') return null;
  const top = (await getMatchMvp(id, 1)).players[0];
  return top ? { playerId: top.playerId, name: top.name, score: top.impact.total, reasons: top.impact.reasons } : null;
}

export async function listEvents(id) {
  if (!mongoose.isValidObjectId(id)) throw notFound('Match');
  const events = await MatchEvent.find({ match: id }).sort({ seq: 1 }).lean();
  return events.map(({ _id, match, ...e }) => e);
}

export function assertObjectId(id, what = 'Resource') {
  if (!mongoose.isValidObjectId(id)) throw new AppError(404, ERROR_CODES.NOT_FOUND, `${what} not found`);
}
