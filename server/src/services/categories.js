// Categories (Men's, Ladies, Kids) of the current season, and the configuration each one uses.
//
// Every tournament query is scoped by category. Requests name a category by key (`?category=ladies`)
// or id; requests that name none get the default category, so clients built before categories
// existed (installed Android apps) keep working against Men's data.

import mongoose from 'mongoose';
import { Category, Match, Player, PlayerMatchStat, Team } from '../models/index.js';
import { CATEGORY_KEYS } from '../models/Category.js';
import { notFound } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { getTournament } from './tournament.js';

export const DEFAULT_CATEGORY_KEY = 'mens';
export const DEFAULT_CATEGORIES = [
  { key: 'mens', name: "Men's", shortName: 'Men', order: 1 },
  { key: 'ladies', name: 'Ladies', shortName: 'Ladies', order: 2 },
  { key: 'kids', name: 'Kids', shortName: 'Kids', order: 3 },
];
// Season-level defaults for settings that did not exist before categories.
// capMinMatches: matches a player must have played to be eligible for the Orange / Purple Cap.
export const LEADERBOARD_DEFAULTS = { strikeRateMinBalls: 30, economyMinBalls: 24, averageMinInnings: 3, capMinMatches: 0 };
export const QUALIFICATION_DEFAULTS = { slots: 4 };

let cache = null; // { season, list, byId: Map, byKey: Map }
let loading = null;

export function invalidateCategories() { cache = null; }

async function load() {
  const t = await getTournament();
  const list = await Category.find({ season: t.currentSeason }).sort({ order: 1 }).lean();
  cache = {
    season: t.currentSeason,
    list,
    byId: new Map(list.map((c) => [String(c._id), c])),
    byKey: new Map(list.map((c) => [c.key, c])),
  };
  return cache;
}

async function loaded() {
  if (cache) return cache;
  if (!loading) loading = load().finally(() => { loading = null; });
  return loading;
}

/** Create the three categories of the current season if missing (idempotent). */
export async function ensureCategories() {
  const t = await getTournament();
  for (const c of DEFAULT_CATEGORIES) {
    await Category.updateOne({ season: t.currentSeason, key: c.key }, { $setOnInsert: { season: t.currentSeason, ...c } }, { upsert: true });
  }
  invalidateCategories();
  return (await loaded()).list;
}

/** Categories of the current season, in display order. */
export async function listCategories() {
  return (await loaded()).list;
}

/** A category by key (current season) or id (any season). Throws 404. */
export async function getCategory(ref) {
  const c = await loaded();
  const s = String(ref);
  let cat = c.byKey.get(s) || c.byId.get(s);
  if (!cat && mongoose.isValidObjectId(s)) cat = await Category.findById(s).lean();
  if (!cat) throw notFound('Category');
  return cat;
}

/** The category a request asked for; the default category when it named none. */
export async function resolveCategory(ref) {
  if (ref === undefined || ref === null || ref === '') return getCategory(DEFAULT_CATEGORY_KEY);
  return getCategory(ref);
}

/** The category of a team / player / match document (default category for legacy documents). */
export async function categoryOf(doc) {
  return doc?.category ? getCategory(doc.category) : getCategory(DEFAULT_CATEGORY_KEY);
}

const defined = (obj) => Object.fromEntries(Object.entries(obj || {}).filter(([, v]) => v !== undefined && v !== null));

/** Effective settings of a category: season defaults overlaid with the category's overrides. */
export async function categoryConfig(cat) {
  const t = await getTournament();
  const points = { ...t.points, ...defined(cat.points) };
  points.bonus = { ...(t.points?.bonus || {}), ...defined(cat.points?.bonus) };
  return {
    rules: { ...t.rules, ...defined(cat.rules) },
    points,
    impactWeights: cat.impactWeights !== undefined && cat.impactWeights !== null ? cat.impactWeights : t.impactWeights,
    leaderboards: { ...LEADERBOARD_DEFAULTS, ...defined(cat.leaderboards) },
    qualification: { ...QUALIFICATION_DEFAULTS, ...defined(cat.qualification) },
  };
}

export function publicCategory(c) {
  return { id: String(c._id), key: c.key, name: c.name, shortName: c.shortName || c.name, season: c.season, order: c.order, active: c.active !== false };
}

/** Category with its overrides and effective settings (admin). */
export async function categoryDetail(cat) {
  return {
    ...publicCategory(cat),
    overrides: {
      rules: defined(cat.rules), points: cat.points || {}, impactWeights: cat.impactWeights ?? null,
      leaderboards: defined(cat.leaderboards), qualification: defined(cat.qualification),
    },
    effective: await categoryConfig(cat),
  };
}

const OVERRIDES = ['rules', 'points', 'impactWeights', 'leaderboards', 'qualification'];

/** Partial update. An override set to null returns that group to the season defaults. */
export async function updateCategory(cat, patch) {
  const set = {};
  const unset = {};
  for (const k of ['name', 'shortName', 'order', 'active']) if (patch[k] !== undefined) set[k] = patch[k];
  for (const k of OVERRIDES) {
    if (patch[k] === null) unset[k] = '';
    else if (patch[k] !== undefined) set[k] = patch[k];
  }
  const update = {};
  if (Object.keys(set).length) update.$set = set;
  if (Object.keys(unset).length) update.$unset = unset;
  if (Object.keys(update).length) await Category.updateOne({ _id: cat._id }, update, { runValidators: true });
  invalidateCategories();
  return getCategory(cat._id);
}

/**
 * Compatibility migration for data created before categories: teams, players, matches and
 * derived statistics without a category are assigned to the default category. Only fills a
 * missing field; never overwrites or deletes anything. Idempotent (runs at every startup).
 */
export async function migrateLegacyData() {
  const def = await getCategory(DEFAULT_CATEGORY_KEY);
  const missing = { category: null };
  const out = {};
  for (const [name, Model] of [['teams', Team], ['players', Player], ['matches', Match], ['playerMatchStats', PlayerMatchStat]]) {
    const r = await Model.updateMany(missing, { $set: { category: def._id } });
    out[name] = r.modifiedCount;
  }
  if (Object.values(out).some(Boolean)) logger.warn({ category: def.key, ...out }, 'assigned legacy documents to the default category');
  return out;
}

export const isCategoryKey = (k) => CATEGORY_KEYS.includes(k);
