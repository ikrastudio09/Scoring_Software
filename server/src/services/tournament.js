import { Tournament } from '../models/index.js';

let cached = null;

/** The tournament document, created with defaults on first access. */
export async function getTournament() {
  if (cached) return cached;
  let t = await Tournament.findOne({ key: 'main' }).lean();
  if (!t) {
    await Tournament.updateOne(
      { key: 'main' },
      { $setOnInsert: { key: 'main', name: process.env.TOURNAMENT_NAME || 'Cricket Tournament' } },
      { upsert: true },
    );
    t = await Tournament.findOne({ key: 'main' }).lean();
  }
  cached = t;
  return t;
}

export async function updateTournament(patch) {
  const set = {};
  // Flatten nested objects so a partial update never wipes sibling fields.
  const flatten = (obj, prefix = '') => {
    for (const [k, v] of Object.entries(obj)) {
      // MVP weights are replaced as a whole (the settings form always sends the full set).
      if (!prefix && k === 'impactWeights') { set.impactWeights = v; continue; }
      if (v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)) flatten(v, `${prefix}${k}.`);
      else set[`${prefix}${k}`] = v;
    }
  };
  flatten(patch);
  await getTournament();
  const t = await Tournament.findOneAndUpdate({ key: 'main' }, { $set: set }, { new: true, runValidators: true }).lean();
  cached = t;
  return t;
}

export function invalidateTournamentCache() {
  cached = null;
}

export function publicTournament(t) {
  const { _id, key, __v, ...rest } = t;
  return { id: String(_id), ...rest };
}
