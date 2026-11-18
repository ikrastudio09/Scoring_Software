// Permanent identities of players and teams across seasons and categories.
//
// Every season player record (Player) and team record (Team) points to an identity. New records
// always get a NEW identity; two records become "the same person / franchise" only when an admin
// links them. Matching names are offered as suggestions, clearly labelled, and never applied
// automatically (names repeat in families and contain typos; phone numbers are shared).

import mongoose from 'mongoose';
import { Category, Player, PlayerIdentity, Team, TeamIdentity } from '../models/index.js';
import { badRequest, conflict, notFound } from '../utils/errors.js';
import { audit } from './audit.js';
import { logger } from '../utils/logger.js';

/**
 * Key for SUGGESTIONS only: letters of the name, lower case, doubled letters collapsed
 * ("MAHHESH  Biyani" → "mahesh biyani" → "maheshbiyani").
 */
export function nameKey(name) {
  return String(name || '').toLowerCase().replace(/[^a-z]/g, '').replace(/(.)\1+/g, '$1');
}

const newPlayerIdentity = (name) => ({ name, nameKey: nameKey(name) });
const newTeamIdentity = (name) => ({ name, nameKey: nameKey(name), aliases: [] });

/** Create identities for the given unsaved player docs (mutates them: sets `identity`). */
export async function assignNewPlayerIdentities(docs) {
  if (!docs.length) return;
  const ids = await PlayerIdentity.insertMany(docs.map((d) => newPlayerIdentity(d.name)));
  docs.forEach((d, i) => { d.identity = ids[i]._id; });
}

export async function assignNewTeamIdentity(doc) {
  doc.identity = (await TeamIdentity.create(newTeamIdentity(doc.name)))._id;
}

/** Compatibility migration: every player and team gets an identity (one new identity each). */
export async function ensureIdentities() {
  const out = { players: 0, teams: 0 };
  const players = await Player.find({ identity: null }, 'name').lean();
  if (players.length) {
    await assignNewPlayerIdentities(players);
    await Player.bulkWrite(players.map((p) => ({ updateOne: { filter: { _id: p._id, identity: null }, update: { $set: { identity: p.identity } } } })));
    out.players = players.length;
  }
  for (const t of await Team.find({ identity: null }, 'name').lean()) {
    await assignNewTeamIdentity(t);
    await Team.updateOne({ _id: t._id, identity: null }, { $set: { identity: t.identity } });
    out.teams += 1;
  }
  if (out.players || out.teams) logger.warn(out, 'created identities for records that had none');
  return out;
}

/** Follow merges to the identity that is still in use. */
async function liveIdentity(Model, id, what) {
  if (!mongoose.isValidObjectId(id)) throw notFound(what);
  let doc = await Model.findById(id).lean();
  for (let i = 0; doc?.mergedInto && i < 10; i++) doc = await Model.findById(doc.mergedInto).lean();
  if (!doc) throw notFound(what);
  return doc;
}

async function categoryNames() {
  const cats = await Category.find({}, 'key name season').lean();
  return new Map(cats.map((c) => [String(c._id), c]));
}

const recordOut = (p, cats) => {
  const c = cats.get(String(p.category));
  return {
    id: String(p._id), name: p.name, playerID: p.playerID ?? null,
    category: c ? { key: c.key, name: c.name, season: c.season } : null,
    team: p.team?.name ? { id: String(p.team._id), name: p.team.name } : null,
  };
};

/** One identity with every season record that points to it. */
export async function getPlayerIdentity(id) {
  const identity = await liveIdentity(PlayerIdentity, id, 'Identity');
  const [records, cats] = await Promise.all([
    Player.find({ identity: identity._id }, 'name playerID category team').populate('team', 'name').lean(),
    categoryNames(),
  ]);
  return { id: String(identity._id), name: identity.name, notes: identity.notes || '', records: records.map((r) => recordOut(r, cats)) };
}

export async function searchPlayerIdentities(q, limit = 20) {
  const key = nameKey(q);
  if (key.length < 2) return [];
  const found = await PlayerIdentity.find({ mergedInto: null, nameKey: { $regex: key.replace(/[^a-z]/g, '') } }).limit(limit).lean();
  return Promise.all(found.map((i) => getPlayerIdentity(i._id)));
}

/**
 * Link a season player record to an existing identity (same person), or — identityId null — give
 * it a new identity of its own (undo a wrong link). A person can have only one record per
 * category of a season. An identity left without records is marked merged, never deleted.
 */
export async function linkPlayerIdentity(playerId, identityId, user) {
  if (!mongoose.isValidObjectId(playerId)) throw notFound('Player');
  const p = await Player.findById(playerId).lean();
  if (!p) throw notFound('Player');
  const before = p.identity ? String(p.identity) : null;
  let target;
  if (identityId) {
    target = await liveIdentity(PlayerIdentity, identityId, 'Identity');
    if (String(target._id) === before) return getPlayerIdentity(target._id);
    if (await Player.exists({ identity: target._id, category: p.category, _id: { $ne: p._id } })) {
      throw conflict('That person already has a record in this category of the season; one person cannot play twice in the same tournament.');
    }
  } else {
    if (before && !(await Player.exists({ identity: before, _id: { $ne: p._id } }))) {
      throw badRequest('This record already has an identity of its own.');
    }
    target = await PlayerIdentity.create(newPlayerIdentity(p.name));
  }
  await Player.updateOne({ _id: p._id }, { $set: { identity: target._id } });
  if (before && identityId && !(await Player.exists({ identity: before }))) {
    await PlayerIdentity.updateOne({ _id: before }, { $set: { mergedInto: target._id } });
  }
  await audit(user, identityId ? 'identity.player.link' : 'identity.player.split', 'player', p._id, { name: p.name, from: before, to: String(target._id) });
  return getPlayerIdentity(target._id);
}

/**
 * Review list for one category: each season record, its identity, and SUGGESTED identities with
 * a similar name that have no record in this category yet. Suggestions are never applied.
 */
export async function playerIdentityReview(category) {
  const [players, cats] = await Promise.all([
    Player.find({ category: category._id }, 'name playerID team identity previousSeason').populate('team', 'name').sort({ name: 1 }).lean(),
    categoryNames(),
  ]);
  const identityIds = players.map((p) => p.identity).filter(Boolean);
  const [mine, sameKey] = await Promise.all([
    PlayerIdentity.find({ _id: { $in: identityIds } }).lean(),
    PlayerIdentity.find({ mergedInto: null, nameKey: { $in: [...new Set(players.map((p) => nameKey(p.name)))] } }).lean(),
  ]);
  const allIds = [...new Set([...identityIds.map(String), ...sameKey.map((i) => String(i._id))])];
  const records = await Player.find({ identity: { $in: allIds } }, 'name playerID category team identity').populate('team', 'name').lean();
  const recordsOf = new Map();
  for (const r of records) {
    const k = String(r.identity);
    if (!recordsOf.has(k)) recordsOf.set(k, []);
    recordsOf.get(k).push(r);
  }
  const byId = new Map(mine.map((i) => [String(i._id), i]));
  return players.map((p) => {
    const own = p.identity ? String(p.identity) : null;
    const key = nameKey(p.name);
    const suggestions = sameKey
      .filter((i) => i.nameKey === key && String(i._id) !== own)
      .filter((i) => !(recordsOf.get(String(i._id)) || []).some((r) => String(r.category) === String(category._id)))
      .map((i) => ({ id: String(i._id), name: i.name, reason: 'Similar name — check before linking', records: (recordsOf.get(String(i._id)) || []).map((r) => recordOut(r, cats)) }));
    const linked = (recordsOf.get(own) || []).filter((r) => String(r._id) !== String(p._id));
    return {
      id: String(p._id), name: p.name, playerID: p.playerID ?? null, team: p.team?.name || null,
      previousTeam: p.previousSeason?.team || null,
      identity: own ? { id: own, name: byId.get(own)?.name || p.name, otherRecords: linked.map((r) => recordOut(r, cats)) } : null,
      suggestions,
    };
  });
}

// ── teams ──

export async function getTeamIdentity(id) {
  const identity = await liveIdentity(TeamIdentity, id, 'Team identity');
  const [teams, cats] = await Promise.all([Team.find({ identity: identity._id }, 'name category teamID').lean(), categoryNames()]);
  return {
    id: String(identity._id), name: identity.name, aliases: identity.aliases || [],
    records: teams.map((t) => {
      const c = cats.get(String(t.category));
      return { id: String(t._id), name: t.name, teamID: t.teamID ?? null, category: c ? { key: c.key, name: c.name, season: c.season } : null };
    }),
  };
}

/** Same rules as players: link to an existing franchise, or split into a new identity. */
export async function linkTeamIdentity(teamId, identityId, user) {
  if (!mongoose.isValidObjectId(teamId)) throw notFound('Team');
  const t = await Team.findById(teamId).lean();
  if (!t) throw notFound('Team');
  const before = t.identity ? String(t.identity) : null;
  let target;
  if (identityId) {
    target = await liveIdentity(TeamIdentity, identityId, 'Team identity');
    if (String(target._id) === before) return getTeamIdentity(target._id);
    if (await Team.exists({ identity: target._id, category: t.category, _id: { $ne: t._id } })) {
      throw conflict('That franchise already has a team in this category of the season.');
    }
  } else {
    if (before && !(await Team.exists({ identity: before, _id: { $ne: t._id } }))) throw badRequest('This team already has an identity of its own.');
    target = await TeamIdentity.create(newTeamIdentity(t.name));
  }
  await Team.updateOne({ _id: t._id }, { $set: { identity: target._id } });
  if (before && identityId && !(await Team.exists({ identity: before }))) {
    await TeamIdentity.updateOne({ _id: before }, { $set: { mergedInto: target._id } });
    // Keep the old name as an alias of the franchise.
    await TeamIdentity.updateOne({ _id: target._id }, { $addToSet: { aliases: t.name } });
  }
  await audit(user, identityId ? 'identity.team.link' : 'identity.team.split', 'team', t._id, { name: t.name, from: before, to: String(target._id) });
  return getTeamIdentity(target._id);
}

export async function teamIdentityReview(category) {
  const teams = await Team.find({ category: category._id }, 'name identity').sort({ name: 1 }).lean();
  const out = [];
  for (const t of teams) {
    const key = nameKey(t.name);
    const candidates = await TeamIdentity.find({ mergedInto: null, _id: { $ne: t.identity }, $or: [{ nameKey: key }, { aliases: t.name }] }).limit(5).lean();
    const suggestions = [];
    for (const c of candidates) {
      if (await Team.exists({ identity: c._id, category: category._id })) continue;
      suggestions.push({ ...(await getTeamIdentity(c._id)), reason: 'Similar name — check before linking' });
    }
    out.push({ id: String(t._id), name: t.name, identity: t.identity ? await getTeamIdentity(t.identity) : null, suggestions });
  }
  return out;
}
