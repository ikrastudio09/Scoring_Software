// Import of historical MPL records (past seasons) from CSV / XLSX / JSON rows.
//
//   validateHistory(input)        PURE: column mapping → normalised rows, errors, warnings, groups
//   planHistory(valid, options)   compare with the database: identity suggestions, duplicates
//   applyHistory(plan, user)      write one undoable batch (HistoricalImport)
//   undoHistoryImport(id, user)   remove exactly the rows of one import
//
// Rows are grouped per person (or franchise) by an optional key column, else by name. A group is
// never linked to an existing identity unless the admin chose it: name matches are suggestions.
// Existing rows are never replaced unless `overwrite` was explicitly confirmed.

import { createHash } from 'node:crypto';
import mongoose from 'mongoose';
import { PERFORMANCE_FIELDS, SUPPLIED_RATES, totalsOf } from '@cricket/shared';
import {
  Category, HistoricalImport, HistoricalPlayerSeason, HistoricalTeamSeason, Player, PlayerIdentity, TeamIdentity,
} from '../models/index.js';
import { CATEGORY_KEYS } from '../models/Category.js';
import { assignNewPlayerIdentities, nameKey } from './identities.js';

const norm = (k) => String(k).toLowerCase().replace(/[^a-z0-9]/g, '');
const blank = (v) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');

// Target fields and the column names recognised automatically (any case / punctuation).
const PERF_ALIASES = {
  seasons: ['seasons'], matches: ['m', 'matches', 'mat', 'played'], innings: ['inns', 'innings', 'i'], runs: ['r', 'runs'],
  ballsFaced: ['bf', 'balls', 'ballsfaced'], notOuts: ['no', 'notouts', 'notout'], fours: ['4s', 'fours'], sixes: ['6s', 'sixes'],
  wickets: ['w', 'wkts', 'wickets'], ballsBowled: ['ballsbowled', 'bb'], runsConceded: ['rc', 'runsconceded', 'conceded'],
  catches: ['c', 'ct', 'catches'], runOuts: ['ro', 'runouts'], stumpings: ['st', 'stumpings'], playerOfMatch: ['mom', 'potm', 'playerofmatch', 'manofthematch'],
};
export const FIELDS = {
  players: [
    { key: 'name', aliases: ['name', 'player', 'playername'], required: true },
    { key: 'personKey', aliases: ['personkey', 'playerkey', 'key'] },
    { key: 'season', aliases: ['season', 'seasonno', 's'] },
    { key: 'year', aliases: ['year'] },
    { key: 'category', aliases: ['category', 'division'] },
    { key: 'team', aliases: ['team', 'teamname'] },
    { key: 'playerID', aliases: ['playerid'] },
    ...PERFORMANCE_FIELDS.map((f) => ({ key: f.key, aliases: PERF_ALIASES[f.key] || [norm(f.key)], perf: true })),
    { key: 'overs', aliases: ['overs', 'o'] },
    { key: 'battingAvg', aliases: ['avg', 'average', 'battingavg', 'battingaverage'], rate: true },
    { key: 'strikeRate', aliases: ['sr', 'strikerate'], rate: true },
    { key: 'economy', aliases: ['econ', 'economy'], rate: true },
    { key: 'bowlingAvg', aliases: ['bowlingavg', 'bowlingaverage'], rate: true },
    { key: 'mvp', aliases: ['mvp', 'seasonmvp', 'mvpaward'] },
  ],
  teams: [
    { key: 'name', aliases: ['name', 'team', 'teamname'], required: true },
    { key: 'teamKey', aliases: ['teamkey', 'key'] },
    { key: 'season', aliases: ['season', 'seasonno', 's'] },
    { key: 'year', aliases: ['year'] },
    { key: 'category', aliases: ['category', 'division'] },
    { key: 'matches', aliases: ['m', 'matches', 'played', 'p'] },
    { key: 'won', aliases: ['w', 'won', 'wins'] },
    { key: 'lost', aliases: ['l', 'lost', 'losses'] },
    { key: 'tied', aliases: ['t', 'tied', 'ties'] },
    { key: 'noResult', aliases: ['nr', 'noresult'] },
    { key: 'points', aliases: ['pts', 'points'] },
    { key: 'nrr', aliases: ['nrr', 'netrunrate'] },
    { key: 'highestScore', aliases: ['highest', 'highestscore', 'hs'] },
    { key: 'position', aliases: ['pos', 'position', 'rank', 'finish'] },
    { key: 'champion', aliases: ['champion', 'champions', 'winner', 'title'] },
    { key: 'finalist', aliases: ['finalist', 'runnerup', 'final'] },
  ],
};

/** Best guess of which column holds each field (the admin can change it). */
export function guessMapping(kind, columns) {
  const out = {};
  for (const f of FIELDS[kind]) {
    const hit = columns.find((c) => f.aliases.includes(norm(c)));
    if (hit) out[f.key] = hit;
  }
  return out;
}

const num = (v) => {
  if (blank(v)) return undefined;
  const n = Number(String(v).replace(/[,\s]/g, ''));
  return Number.isFinite(n) ? n : NaN;
};
const truthy = (v) => (blank(v) ? false : /^(1|y|yes|true|✓|x|champion|winner|runner ?up)$/i.test(String(v).trim()));

/**
 * input = { kind: 'players'|'teams', rows: [objects], mapping: {field: column}, category?: key,
 *           categoryValues?: {value: key}, seasonFromYear?: {year, season}, currentSeason }
 */
export function validateHistory(input) {
  const errors = [];
  const warnings = [];
  const err = (row, message) => errors.push({ row, message });
  const warn = (row, message) => warnings.push({ row, message });
  const { kind, rows = [], mapping = {}, currentSeason } = input;
  if (!FIELDS[kind]) return { ok: false, errors: [{ row: null, message: 'Unknown import kind' }], warnings, rows: [], groups: [] };
  const get = (raw, key) => (mapping[key] ? raw[mapping[key]] : undefined);
  const out = [];
  if (!mapping.name) err(null, 'Choose the column that holds the name.');
  if (!mapping.season && !mapping.year) err(null, 'Choose a season or a year column.');
  if (mapping.year && !mapping.season && !(Number.isInteger(input.seasonFromYear?.year) && Number.isInteger(input.seasonFromYear?.season))) {
    err(null, 'Years need a season mapping (e.g. year 2025 = season 20).');
  }
  if (!mapping.category && !CATEGORY_KEYS.includes(input.category)) err(null, 'Choose the category of this file, or a category column.');
  if (errors.length) return { ok: false, errors, warnings, rows: [], groups: [] };

  rows.forEach((raw, i) => {
    const r = i + 2; // spreadsheet row number (header is row 1)
    const name = String(get(raw, 'name') ?? '').trim();
    if (!name) return err(r, 'Name is missing.');
    let season = num(get(raw, 'season'));
    if (season === undefined && mapping.year) {
      const year = num(get(raw, 'year'));
      if (Number.isInteger(year)) season = input.seasonFromYear.season - (input.seasonFromYear.year - year);
    }
    if (!Number.isInteger(season) || season < 1) return err(r, `${name}: season is missing or not a whole number.`);
    if (season >= currentSeason) return err(r, `${name}: season ${season} is scored in this system — importing it would count it twice.`);
    let categoryKey = input.category;
    if (mapping.category) {
      const v = String(get(raw, 'category') ?? '').trim();
      categoryKey = input.categoryValues?.[v];
      if (!CATEGORY_KEYS.includes(categoryKey)) return err(r, `${name}: category "${v}" is not mapped to Men's, Ladies or Kids.`);
    }
    const data = { name, season, categoryKey };
    let bad = false;
    const whole = (key, label = key) => {
      const v = num(get(raw, key));
      if (v === undefined) return undefined;
      if (!Number.isInteger(v) || v < 0) { err(r, `${name}: ${label} "${get(raw, key)}" is not a whole number ≥ 0.`); bad = true; return undefined; }
      return v;
    };
    if (kind === 'players') {
      data.groupKey = blank(get(raw, 'personKey')) ? `n:${nameKey(name)}` : `k:${String(get(raw, 'personKey')).trim()}`;
      data.teamName = String(get(raw, 'team') ?? '').trim() || undefined;
      const pid = num(get(raw, 'playerID'));
      if (Number.isInteger(pid) && pid > 0) data.playerID = pid;
      const perf = {};
      for (const f of PERFORMANCE_FIELDS) { const v = whole(f.key, f.label); if (v !== undefined) perf[f.key] = v; }
      const overs = get(raw, 'overs');
      if (!blank(overs) && perf.ballsBowled === undefined) {
        const m = String(overs).trim().match(/^(\d+)(?:\.([0-5]))?$/);
        if (m) perf.ballsBowled = Number(m[1]) * 6 + Number(m[2] || 0); else { err(r, `${name}: overs "${overs}" is not like 12.3.`); bad = true; }
      }
      const supplied = {};
      for (const rr of SUPPLIED_RATES) {
        const v = num(get(raw, rr.key));
        if (v === undefined) continue;
        if (!(v >= 0)) { err(r, `${name}: ${rr.label} "${get(raw, rr.key)}" is not a number.`); bad = true; } else supplied[rr.key] = v;
      }
      if (Object.keys(supplied).length) perf.supplied = supplied;
      if (!Object.keys(totalsOf(perf)).length && !perf.supplied) { err(r, `${name}: no statistics in this row.`); bad = true; }
      if (perf.seasons !== undefined && perf.seasons !== 1) warn(r, `${name}: a season row should cover one season; "seasons" was ignored.`);
      perf.seasons = 1;
      perf.meta = { season };
      data.performance = perf;
      data.mvpAward = truthy(get(raw, 'mvp')) || undefined;
    } else {
      data.groupKey = blank(get(raw, 'teamKey')) ? `n:${nameKey(name)}` : `k:${String(get(raw, 'teamKey')).trim()}`;
      for (const k of ['matches', 'won', 'lost', 'tied', 'noResult', 'points', 'highestScore', 'position']) {
        const v = whole(k);
        if (v !== undefined) data[k] = v;
      }
      const nrr = num(get(raw, 'nrr'));
      if (nrr !== undefined) { if (Number.isNaN(nrr)) { err(r, `${name}: NRR "${get(raw, 'nrr')}" is not a number.`); bad = true; } else data.nrr = nrr; }
      data.champion = truthy(get(raw, 'champion'));
      data.finalist = data.champion || truthy(get(raw, 'finalist'));
      const results = ['won', 'lost', 'tied', 'noResult'].map((k) => data[k] ?? 0).reduce((a, b) => a + b, 0);
      if (data.matches !== undefined && results > data.matches) { err(r, `${name}: wins, losses, ties and no results add up to more than ${data.matches} matches.`); bad = true; }
    }
    if (!bad) out.push({ ...data, row: r });
  });

  // Duplicates inside the file: one person / franchise twice in the same season and category.
  const seen = new Map();
  for (const x of out) {
    const k = `${x.groupKey}|${x.season}|${x.categoryKey}`;
    if (seen.has(k)) err(x.row, `${x.name} appears twice for season ${x.season} (rows ${seen.get(k)} and ${x.row}). If these are two different people with the same name, add a key column to tell them apart.`);
    else seen.set(k, x.row);
  }
  if (kind === 'teams') {
    const champs = new Map();
    for (const x of out.filter((t) => t.champion)) {
      const k = `${x.season}|${x.categoryKey}`;
      if (champs.has(k)) err(x.row, `Season ${x.season} has two champions (${champs.get(k)} and ${x.name}).`);
      else champs.set(k, x.name);
    }
  }
  const groups = [];
  const byKey = new Map();
  for (const x of out) {
    if (!byKey.has(x.groupKey)) { byKey.set(x.groupKey, { key: x.groupKey, name: x.name, rows: [] }); groups.push(byKey.get(x.groupKey)); }
    byKey.get(x.groupKey).rows.push(x);
  }
  if (!out.length && !errors.length) err(null, 'No rows to import.');
  return { ok: errors.length === 0, errors, warnings, rows: out, groups };
}

export const hashHistory = (x) => createHash('sha256').update(JSON.stringify(x)).digest('hex');

async function liveIdentityId(Model, id) {
  if (!mongoose.isValidObjectId(id)) return null;
  let doc = await Model.findById(id, 'mergedInto').lean();
  for (let i = 0; doc?.mergedInto && i < 10; i++) doc = await Model.findById(doc.mergedInto, 'mergedInto').lean();
  return doc ? String(doc._id) : null;
}

/**
 * choices: { [groupKey]: 'new' | identityId }. overwrite: replace rows already in the database.
 * Adds errors for impossible links; returns per-group suggestions and the actions.
 */
export async function planHistory(valid, { kind, choices = {}, overwrite = false }) {
  const errors = [];
  const warnings = [];
  const Identity = kind === 'players' ? PlayerIdentity : TeamIdentity;
  const Row = kind === 'players' ? HistoricalPlayerSeason : HistoricalTeamSeason;
  const idField = kind === 'players' ? 'identity' : 'teamIdentity';
  const keys = [...new Set(valid.groups.map((g) => nameKey(g.name)))];
  const candidates = await Identity.find(
    kind === 'players' ? { mergedInto: null, nameKey: { $in: keys } } : { mergedInto: null, $or: [{ nameKey: { $in: keys } }, { aliases: { $in: valid.groups.map((g) => g.name) } }] },
    'name nameKey aliases',
  ).lean();
  const cats = new Map((await Category.find({}, 'season key').lean()).map((c) => [String(c._id), c]));

  const groups = [];
  const claimed = new Map(); // identity|season|cat → group name
  for (const g of valid.groups) {
    const k = nameKey(g.name);
    const suggestions = candidates.filter((c) => c.nameKey === k || (c.aliases || []).includes(g.name))
      .map((c) => ({ id: String(c._id), name: c.name, reason: 'Similar name — check before linking' }));
    let choice = choices[g.key] || 'new';
    let identityId = null;
    if (choice !== 'new') {
      identityId = await liveIdentityId(Identity, choice);
      if (!identityId) { errors.push({ row: g.rows[0].row, message: `${g.name}: the chosen identity does not exist.` }); choice = 'new'; }
    }
    const rows = [];
    for (const r of g.rows) {
      let action = 'create';
      if (identityId) {
        const k2 = `${identityId}|${r.season}|${r.categoryKey}`;
        if (claimed.has(k2)) errors.push({ row: r.row, message: `${g.name} and ${claimed.get(k2)} are linked to the same identity for season ${r.season}.` });
        claimed.set(k2, g.name);
        if (await Row.exists({ [idField]: identityId, season: r.season, categoryKey: r.categoryKey })) {
          action = overwrite ? 'replace' : 'skip';
          if (!overwrite) warnings.push({ row: r.row, message: `${g.name}, season ${r.season}: already imported — kept (tick "replace existing rows" to overwrite).` });
        }
        if (kind === 'players') {
          // A season scored ball by ball in this system must never also come from a file.
          const scored = await Player.find({ identity: identityId }, 'category').lean();
          if (scored.some((p) => cats.get(String(p.category))?.season === r.season && cats.get(String(p.category))?.key === r.categoryKey)) {
            errors.push({ row: r.row, message: `${g.name}: season ${r.season} is scored in this system for this person.` });
          }
        }
      }
      rows.push({ ...r, action });
    }
    groups.push({ key: g.key, name: g.name, choice, identityId, suggestions, rows });
  }
  const count = (a) => groups.flatMap((g) => g.rows).filter((r) => r.action === a).length;
  return {
    errors, warnings, groups,
    counts: { create: count('create'), replace: count('replace'), skip: count('skip'), newIdentities: groups.filter((g) => g.choice === 'new').length },
  };
}

export async function applyHistory(plan, { kind, categoryKey, fileName, hash }, user) {
  const imp = await HistoricalImport.create({ kind, categoryKey: categoryKey || null, fileName, hash, summary: plan.counts, createdBy: user?.username });
  const fresh = plan.groups.filter((g) => g.choice === 'new');
  if (kind === 'players') {
    await assignNewPlayerIdentities(fresh); // sets g.identity
    for (const g of fresh) g.identityId = String(g.identity);
  } else {
    const docs = await TeamIdentity.insertMany(fresh.map((g) => ({ name: g.name, nameKey: nameKey(g.name), aliases: [] })));
    fresh.forEach((g, i) => { g.identityId = String(docs[i]._id); });
  }
  const ops = [];
  const replaceFilters = [];
  for (const g of plan.groups) {
    for (const r of g.rows) {
      if (r.action === 'skip') continue;
      const filter = kind === 'players'
        ? { identity: g.identityId, season: r.season, categoryKey: r.categoryKey }
        : { teamIdentity: g.identityId, season: r.season, categoryKey: r.categoryKey };
      const doc = kind === 'players'
        ? { ...filter, name: r.name, teamName: r.teamName, playerID: r.playerID, performance: r.performance, mvpAward: r.mvpAward, importId: imp._id }
        : { ...filter, name: r.name, ...Object.fromEntries(['matches', 'won', 'lost', 'tied', 'noResult', 'points', 'nrr', 'highestScore', 'position'].filter((k) => r[k] !== undefined).map((k) => [k, r[k]])), champion: r.champion, finalist: r.finalist, importId: imp._id };
      if (r.action === 'replace') replaceFilters.push(filter);
      ops.push({ replaceOne: { filter, replacement: doc, upsert: true } });
    }
  }
  const Row = kind === 'players' ? HistoricalPlayerSeason : HistoricalTeamSeason;
  if (replaceFilters.length) {
    imp.replaced = await Row.find({ $or: replaceFilters }).lean();
    await imp.save();
  }
  if (ops.length) await Row.bulkWrite(ops, { ordered: true });
  return { importId: String(imp._id), ...plan.counts };
}

/** Remove the rows written by one import and put back any rows it replaced. */
export async function undoHistoryImport(id, user) {
  if (!mongoose.isValidObjectId(id)) return null;
  const imp = await HistoricalImport.findById(id);
  if (!imp || imp.undoneAt) return null;
  const Row = imp.kind === 'players' ? HistoricalPlayerSeason : HistoricalTeamSeason;
  const { deletedCount } = await Row.deleteMany({ importId: imp._id });
  if (imp.replaced?.length) await Row.insertMany(imp.replaced);
  imp.undoneAt = new Date();
  imp.undoneBy = user?.username;
  await imp.save();
  return { removed: deletedCount, restored: imp.replaced?.length || 0 };
}
