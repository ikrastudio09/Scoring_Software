// One-time import of the auction/registration data into the scoring database (spec §6–§12).
//
//   validateAuctionImport(input)  PURE: normalise + validate → { errors, warnings, info, checks, data }
//   planAuctionImport(data)       compare with the database → what would be created / updated
//   applyAuctionImport(plan)      write it
//
// The scoring system never calls the auction system at runtime: after this import the scoring
// database owns its own snapshot. playerID and teamID are the only relationship keys inside one
// category of one season — names are display data, and a playerID is NOT a person across seasons
// (see services/identities.js). playerPhone is dropped here and never stored; Age is stored for
// administrators only. The two historical aggregates (previous year, overall previous) are read
// from structured fields or parsed from the "Previous Statistics" text.

import { createHash } from 'node:crypto';
import mongoose from 'mongoose';
import { PERFORMANCE_FIELDS, SUPPLIED_RATES, derivePreviousPerformance, parsePreviousStatistics, totalsOf } from '@cricket/shared';
import { Match, Player, PlayerMatchStat, Team } from '../models/index.js';
import { assignNewPlayerIdentities, assignNewTeamIdentity } from './identities.js';

export const PLAYING_STYLES = ['Right Arm Batting', 'Right Arm Balling', 'Left Arm Batting', 'Left Arm Balling'];
const STYLE_BY_KEY = new Map(PLAYING_STYLES.map((s) => [norm(s), s]));
const TEAM_COLORS = ['#b91c1c', '#1d4ed8', '#047857', '#7c3aed', '#c2410c', '#0f766e', '#be185d', '#4d7c0f', '#0369a1', '#a16207', '#6d28d9', '#334155'];

function norm(k) { return String(k).toLowerCase().replace(/[^a-z0-9]/g, ''); }

/** Value of the first matching key (case/punctuation-insensitive), also looking one level deep. */
function field(obj, ...names) {
  const want = names.map(norm);
  for (const [k, v] of Object.entries(obj)) if (want.includes(norm(k))) return v;
  return undefined;
}

const blank = (v) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');

/** Number from JSON, CSV text or mongoexport ({"$numberInt": "5"}). NaN when not a number. */
function toNumber(v) {
  if (blank(v)) return undefined;
  if (typeof v === 'object') v = v.$numberInt ?? v.$numberLong ?? v.$numberDouble ?? v.$numberDecimal ?? NaN;
  if (typeof v === 'number') return v;
  const n = Number(String(v).replace(/[,\s₹]/g, ''));
  return Number.isFinite(n) ? n : NaN;
}
const isId = (n) => Number.isInteger(n) && n > 0;
const text = (v) => (blank(v) ? '' : String(v).trim());
/** Text where the export writes NULL / N/A for "none". */
const optionalText = (v) => (/^(null|n\/?a|none|-)$/i.test(text(v)) ? '' : text(v));

// Field aliases accepted in structured performance blocks (case/punctuation-insensitive).
const PERF_ALIASES = {
  innings: ['inns'], ballsFaced: ['balls'], notOuts: ['notout'], runsConceded: ['conceded'],
  playerOfMatch: ['mom', 'potm', 'manofthematch'],
};
const RATE_ALIASES = { battingAvg: ['avg', 'average', 'battingaverage'], strikeRate: ['sr'], economy: ['econ'], bowlingAvg: ['bowlingaverage'] };

/** A structured aggregate (e.g. previousYearPerformance: {matches, runs, …}) → { block, problems }. */
export function readPerformanceBlock(obj) {
  const problems = [];
  if (obj === null || obj === undefined || obj === '') return { block: null, problems };
  if (typeof obj !== 'object' || Array.isArray(obj)) return { block: null, problems: ['is not an object'] };
  const block = {};
  const used = new Set();
  const take = (key, aliases = []) => {
    for (const [k, v] of Object.entries(obj)) {
      if ([key, ...aliases].map(norm).includes(norm(k))) { used.add(k); return v; }
    }
    return undefined;
  };
  for (const f of PERFORMANCE_FIELDS) {
    const raw = take(f.key, PERF_ALIASES[f.key]);
    const n = toNumber(raw);
    if (n === undefined) continue;
    if (!Number.isInteger(n) || n < 0) problems.push(`${f.key} "${raw}" is not a whole number ≥ 0`); else block[f.key] = n;
  }
  // Overs (6-ball) are converted exactly to balls when balls bowled are not given.
  const overs = take('overs');
  if (!blank(overs) && block.ballsBowled === undefined) {
    const m = String(overs).match(/^(\d+)(?:\.([0-5]))?$/);
    if (m) block.ballsBowled = Number(m[1]) * 6 + Number(m[2] || 0); else problems.push(`overs "${overs}" is not like 12.3`);
  }
  const supplied = {};
  for (const r of SUPPLIED_RATES) {
    const raw = take(r.key, RATE_ALIASES[r.key]);
    const n = toNumber(raw);
    if (n === undefined) continue;
    if (!(n >= 0)) problems.push(`${r.key} "${raw}" is not a number`); else supplied[r.key] = n;
  }
  if (Object.keys(supplied).length) block.supplied = supplied;
  const label = take('label', ['seasonLabel']);
  if (!blank(label)) block.meta = { label: String(label) };
  for (const k of Object.keys(obj)) if (!used.has(k)) problems.push(`unknown field "${k}"`);
  return { block: Object.keys(totalsOf(block)).length || block.supplied ? block : null, problems };
}

/** The player's historical aggregates from structured blocks or the "Previous Statistics" text. */
function readHistory(raw) {
  const structuredPrev = field(raw, 'previousYearPerformance');
  const structuredAll = field(raw, 'overallPreviousPerformance');
  if (structuredPrev !== undefined || structuredAll !== undefined) {
    const a = readPerformanceBlock(structuredPrev);
    const b = readPerformanceBlock(structuredAll);
    const flags = [
      ...a.problems.map((m) => ({ code: 'HISTORY_FIELD_INVALID', message: `previousYearPerformance: ${m}` })),
      ...b.problems.map((m) => ({ code: 'HISTORY_FIELD_INVALID', message: `overallPreviousPerformance: ${m}` })),
    ];
    return { previousYear: a.block, overallPrevious: b.block, raw: null, flags };
  }
  const txt = field(raw, 'previousPerformance', 'previousStatistics', 'previousStats');
  if (txt === undefined) return null;
  if (typeof txt === 'object') return { previousYear: null, overallPrevious: null, raw: null, flags: [{ code: 'HISTORY_UNREADABLE', message: 'previousPerformance is not text' }] };
  const out = derivePreviousPerformance(parsePreviousStatistics(txt));
  return { ...out, raw: text(txt) || null };
}

function photoUrlOf(raw) {
  const photo = field(raw, 'playerPhoto');
  const url = text(photo && typeof photo === 'object' ? photo.url : photo)
    || text(field(raw, 'playerPhoto.url', 'playerPhotoUrl', 'photoUrl', 'photo'));
  return url;
}

function stylesOf(raw) {
  const v = field(raw, 'playingStyle', 'playingStyles');
  if (blank(v)) return { styles: [], unknown: [] };
  const list = Array.isArray(v) ? v : String(v).split(/[;,|/]/);
  const styles = [];
  const unknown = [];
  for (const s of list.map(text).filter(Boolean)) {
    const hit = STYLE_BY_KEY.get(norm(s)) || STYLE_BY_KEY.get(norm(s).replace('bowling', 'balling'));
    if (hit) { if (!styles.includes(hit)) styles.push(hit); } else unknown.push(s);
  }
  return { styles, unknown };
}

/**
 * input = { players: [auction Player docs or sheet rows], teams: [auction Team docs or sheet rows] }
 * Teams may be nested ({teamID, teamName, teamPlayers:[{playerID,...}]}) or flat rows
 * ({teamID, teamName, playerID, ...} — one row per team member). Players may also carry
 * teamID/teamName columns directly.
 */
export function validateAuctionImport(input) {
  const errors = [];
  const warnings = [];
  const info = [];
  const err = (code, ref, message) => errors.push({ code, ref, message });
  const warn = (code, ref, message) => warnings.push({ code, ref, message });
  const rawPlayers = Array.isArray(input?.players) ? input.players : [];
  const rawTeams = Array.isArray(input?.teams) ? input.teams : [];

  // ── players ──
  const players = new Map(); // playerID → player
  const historyFlags = [];
  let phones = 0;
  rawPlayers.forEach((raw, i) => {
    if (!raw || typeof raw !== 'object') return;
    const row = `Players row ${i + 1}`;
    const idRaw = field(raw, 'playerID', 'playerId');
    const id = toNumber(idRaw);
    const name = text(field(raw, 'playerName', 'name'));
    if (!blank(field(raw, 'playerPhone', 'phone', 'mobile', 'mobileNo', 'mobileNumber'))) phones += 1;
    if (id === undefined) return err('PLAYER_ID_MISSING', row, `${name || 'A player'} has no playerID.`);
    if (!isId(id)) return err('PLAYER_ID_INVALID', row, `playerID "${idRaw}" is not a positive whole number.`);
    const ref = `Player ${id}`;
    if (players.has(id)) return err('PLAYER_ID_DUPLICATE', ref, `playerID ${id} appears more than once (${players.get(id).name} / ${name}).`);
    if (!name) err('PLAYER_NAME_MISSING', ref, 'Player name is missing.');

    const statusRaw = text(field(raw, 'playerStatus', 'status')).toLowerCase();
    if (statusRaw && !['sold', 'unsold'].includes(statusRaw)) err('PLAYER_STATUS_INVALID', ref, `Status "${statusRaw}" is not sold or unsold.`);

    const soldPoints = toNumber(field(raw, 'soldPoints', 'auctionValue', 'soldPrice'));
    if (soldPoints !== undefined && !(soldPoints >= 0)) err('AUCTION_VALUE_INVALID', ref, `soldPoints "${field(raw, 'soldPoints', 'auctionValue', 'soldPrice')}" is not a valid amount.`);
    const playerPool = toNumber(field(raw, 'playerPool', 'pool'));
    if (playerPool !== undefined && !(playerPool >= 0)) err('PLAYER_POOL_INVALID', ref, `playerPool "${field(raw, 'playerPool', 'pool')}" is not valid.`);

    const { styles, unknown } = stylesOf(raw);
    if (unknown.length) warn('PLAYING_STYLE_UNKNOWN', ref, `Unknown playing style ignored: ${unknown.join(', ')}.`);
    const photoUrl = photoUrlOf(raw);
    if (photoUrl && !/^https?:\/\//i.test(photoUrl)) warn('PHOTO_URL_INVALID', ref, 'Photo URL is not an http(s) link and was ignored.');

    const ageRaw = field(raw, 'Age', 'age');
    const ageNum = toNumber(ageRaw);
    let age = null;
    if (ageNum !== undefined) {
      if (Number.isInteger(ageNum) && ageNum >= 5 && ageNum <= 100) age = ageNum;
      else warn('AGE_INVALID', ref, `Age "${ageRaw}" is not plausible and was not imported.`);
    }
    const prevTeam = optionalText(field(raw, 'previousTeam'));
    const prevPointsRaw = optionalText(field(raw, 'previousTeamPoints', 'previousPoints'));
    const prevPoints = toNumber(prevPointsRaw);
    if (prevPointsRaw && !(prevPoints >= 0)) warn('PREVIOUS_POINTS_INVALID', ref, `previousTeamPoints "${prevPointsRaw}" is not a number and was not imported.`);
    const history = readHistory(raw);
    for (const f of history?.flags || []) historyFlags.push({ ...f, ref });

    const teamIdRaw = field(raw, 'teamID', 'teamId');
    const teamID = toNumber(teamIdRaw);
    if (teamID !== undefined && !isId(teamID)) err('TEAM_ID_INVALID', ref, `teamID "${teamIdRaw}" is not a positive whole number.`);

    players.set(id, {
      playerID: id,
      name,
      playerType: text(field(raw, 'playerType', 'role')),
      playingStyle: styles,
      photoUrl: /^https?:\/\//i.test(photoUrl) ? photoUrl : '',
      soldPoints: Number.isFinite(soldPoints) && soldPoints >= 0 ? soldPoints : 0,
      playerPool: Number.isFinite(playerPool) && playerPool >= 0 ? playerPool : null,
      statusGiven: ['sold', 'unsold'].includes(statusRaw) ? statusRaw : null,
      age,
      previousSeason: prevTeam || prevPoints > 0 ? { team: prevTeam || null, points: prevPoints >= 0 ? prevPoints : null } : null,
      history,
      teamHint: isId(teamID) ? { teamID, teamName: text(field(raw, 'teamName')) } : null,
    });
  });
  if (phones) info.push({ code: 'PRIVATE_DATA_DROPPED', message: `playerPhone was present for ${phones} player${phones === 1 ? '' : 's'} and was NOT imported (private data).` });
  const withAge = [...players.values()].filter((p) => p.age !== null).length;
  if (withAge) info.push({ code: 'AGE_PRIVATE', message: `Age imported for ${withAge} player${withAge === 1 ? '' : 's'}: visible to administrators only, never shown publicly.` });
  // History problems: one summary warning per kind (per-player details are in the preview).
  const byCode = new Map();
  for (const f of historyFlags) {
    if (!byCode.has(f.code)) byCode.set(f.code, []);
    byCode.get(f.code).push(f);
  }
  for (const [code, list] of byCode) {
    warnings.push({ code, ref: list.length === 1 ? list[0].ref : `${list.length} players`, message: list.length === 1 ? list[0].message : `${list.length} players, e.g. ${list[0].ref}: ${list[0].message}` });
  }
  const withHistory = [...players.values()].filter((p) => p.history?.previousYear || p.history?.overallPrevious).length;
  if (withHistory) info.push({ code: 'HISTORY_IMPORTED', message: `Previous performance found for ${withHistory} player${withHistory === 1 ? '' : 's'} (previous year and overall previous are kept separate).` });

  // ── teams (nested documents or flat rows, merged by teamID) ──
  const teams = new Map(); // teamID → { teamID, name, members: Map(playerID → entry) }
  const memberOf = new Map(); // playerID → teamID
  const addTeam = (teamID, name, ref) => {
    let t = teams.get(teamID);
    if (!t) { t = { teamID, name, members: new Map() }; teams.set(teamID, t); return { t, created: true }; }
    if (name && t.name && norm(name) !== norm(t.name)) err('TEAM_NAME_CONFLICT', ref, `teamID ${teamID} is named both "${t.name}" and "${name}".`);
    if (!t.name) t.name = name;
    return { t, created: false };
  };
  const addMember = (t, entry, ref) => {
    const { playerID } = entry;
    if (t.members.has(playerID)) return err('TEAM_PLAYER_DUPLICATE', ref, `Player ${playerID} is listed twice in ${t.name || `team ${t.teamID}`}.`);
    const other = memberOf.get(playerID);
    if (other !== undefined && other !== t.teamID) {
      return err('PLAYER_MULTIPLE_TEAMS', `Player ${playerID}`, `Player ${playerID} is assigned to both team ${other} and team ${t.teamID}.`);
    }
    t.members.set(playerID, entry);
    memberOf.set(playerID, t.teamID);
    return null;
  };
  const memberEntry = (raw, ref) => {
    const idRaw = field(raw, 'playerID', 'playerId');
    const id = toNumber(idRaw);
    if (id === undefined) return null;
    if (!isId(id)) { err('PLAYER_ID_INVALID', ref, `Team member playerID "${idRaw}" is not a positive whole number.`); return null; }
    const sp = toNumber(field(raw, 'soldPoints'));
    if (sp !== undefined && !(sp >= 0)) err('AUCTION_VALUE_INVALID', ref, `soldPoints for player ${id} is not a valid amount.`);
    return { playerID: id, name: text(field(raw, 'playerName', 'name')), soldPoints: Number.isFinite(sp) ? sp : undefined };
  };

  const seenTeamDocs = new Set();
  rawTeams.forEach((raw, i) => {
    if (!raw || typeof raw !== 'object') return;
    const row = `Teams row ${i + 1}`;
    const idRaw = field(raw, 'teamID', 'teamId');
    const teamID = toNumber(idRaw);
    const name = text(field(raw, 'teamName', 'name'));
    if (teamID === undefined) return err('TEAM_ID_MISSING', row, `${name || 'A team'} has no teamID.`);
    if (!isId(teamID)) return err('TEAM_ID_INVALID', row, `teamID "${idRaw}" is not a positive whole number.`);
    const ref = `Team ${teamID}`;
    const nested = field(raw, 'teamPlayers');
    if (Array.isArray(nested)) {
      // One document per team: a second document with the same teamID is a duplicate.
      if (seenTeamDocs.has(teamID)) return err('TEAM_ID_DUPLICATE', ref, `teamID ${teamID} appears more than once.`);
      seenTeamDocs.add(teamID);
      const { t } = addTeam(teamID, name, ref);
      nested.forEach((m, j) => {
        if (!m || typeof m !== 'object') return;
        const e = memberEntry(m, `${ref}, player ${j + 1}`);
        if (!e) { if (toNumber(field(m, 'playerID', 'playerId')) === undefined) err('PLAYER_ID_MISSING', ref, `Team player ${j + 1} (${text(field(m, 'playerName')) || 'unnamed'}) has no playerID.`); return; }
        addMember(t, e, ref);
      });
      return;
    }
    const { t } = addTeam(teamID, name, ref);
    const list = field(raw, 'playerIDs', 'players');
    if (!blank(list) && !Array.isArray(list)) {
      for (const part of String(list).split(/[;,|\s]+/).filter(Boolean)) {
        const id = toNumber(part);
        if (!isId(id)) { err('PLAYER_ID_INVALID', ref, `"${part}" in the player list is not a valid playerID.`); continue; }
        addMember(t, { playerID: id, name: '' }, ref);
      }
    } else {
      const e = memberEntry(raw, `${ref} (${row})`);
      if (e) addMember(t, e, ref);
    }
  });

  // Players that carry their own team columns (single-sheet exports).
  for (const p of players.values()) {
    if (!p.teamHint) continue;
    const { teamID, teamName } = p.teamHint;
    const current = memberOf.get(p.playerID);
    if (current !== undefined && current !== teamID) {
      err('PLAYER_MULTIPLE_TEAMS', `Player ${p.playerID}`, `Player ${p.playerID} has teamID ${teamID} but is listed in team ${current}.`);
      continue;
    }
    const { t } = addTeam(teamID, teamName, `Team ${teamID}`);
    if (current === undefined) addMember(t, { playerID: p.playerID, name: p.name }, `Team ${teamID}`);
  }

  // ── team checks ──
  const names = new Map();
  for (const t of teams.values()) {
    const ref = `Team ${t.teamID}`;
    if (!t.name) { err('TEAM_NAME_MISSING', ref, `teamID ${t.teamID} has no team name.`); continue; }
    const k = norm(t.name);
    if (names.has(k)) err('TEAM_NAME_DUPLICATE', ref, `Team name "${t.name}" is used by teamID ${names.get(k)} and ${t.teamID}.`);
    else names.set(k, t.teamID);
    if (!t.members.size) warn('TEAM_EMPTY', ref, `${t.name} has no players.`);
    for (const m of t.members.values()) {
      const p = players.get(m.playerID);
      if (!p) { err('TEAM_PLAYER_UNKNOWN', ref, `${t.name} references player ${m.playerID}${m.name ? ` (${m.name})` : ''}, who does not exist in the player list.`); continue; }
      if (m.name && p.name && norm(m.name) !== norm(p.name)) warn('PLAYER_NAME_MISMATCH', `Player ${p.playerID}`, `Named "${p.name}" in the player list but "${m.name}" in ${t.name}. The player list name is used.`);
      if (m.soldPoints !== undefined && m.soldPoints !== p.soldPoints) {
        warn('AUCTION_VALUE_MISMATCH', `Player ${p.playerID}`, `soldPoints is ${p.soldPoints} in the player list but ${m.soldPoints} in ${t.name}. The team value is used.`);
        p.soldPoints = m.soldPoints;
      }
    }
  }

  // ── player ↔ team consistency ──
  let unsold = 0;
  for (const p of players.values()) {
    const ref = `Player ${p.playerID}`;
    const teamID = memberOf.get(p.playerID);
    p.teamID = teamID ?? null;
    p.status = p.statusGiven ?? (teamID !== undefined ? 'sold' : 'unsold');
    if (p.status === 'sold' && teamID === undefined) err('SOLD_WITHOUT_TEAM', ref, `${p.name || ref} is sold but not assigned to any team.`);
    if (p.status === 'unsold' && teamID !== undefined) err('UNSOLD_IN_TEAM', ref, `${p.name || ref} is unsold but listed in team ${teamID}.`);
    if (p.status === 'sold' && teamID !== undefined && !p.soldPoints) warn('AUCTION_VALUE_ZERO', ref, `${p.name} is sold for 0 points.`);
    if (p.status === 'unsold') unsold += 1;
    if (p.playerPool === null && p.status === 'sold') warn('PLAYER_POOL_MISSING', ref, `${p.name} has no playerPool.`);
    delete p.statusGiven;
    delete p.teamHint;
  }
  if (unsold) info.push({ code: 'UNSOLD_SKIPPED', message: `${unsold} unsold player${unsold === 1 ? ' is' : 's are'} not on any team and will not be imported.` });

  const has = (...codes) => errors.some((e) => codes.includes(e.code));
  const sold = [...players.values()].filter((p) => p.status === 'sold' && p.teamID !== null);
  const checks = [
    { ok: players.size > 0, label: `${players.size} player${players.size === 1 ? '' : 's'} found (${sold.length} sold, ${unsold} unsold)` },
    { ok: teams.size > 0, label: `${teams.size} team${teams.size === 1 ? '' : 's'} found` },
    { ok: !has('PLAYER_ID_MISSING', 'PLAYER_ID_INVALID', 'PLAYER_ID_DUPLICATE', 'PLAYER_NAME_MISSING'), label: 'Player IDs valid' },
    { ok: !has('TEAM_ID_MISSING', 'TEAM_ID_INVALID', 'TEAM_ID_DUPLICATE', 'TEAM_NAME_MISSING', 'TEAM_NAME_DUPLICATE', 'TEAM_NAME_CONFLICT'), label: 'Team IDs valid' },
    { ok: !has('TEAM_PLAYER_UNKNOWN', 'TEAM_PLAYER_DUPLICATE', 'PLAYER_MULTIPLE_TEAMS', 'SOLD_WITHOUT_TEAM', 'UNSOLD_IN_TEAM'), label: 'Player-team relationships valid' },
    { ok: !has('AUCTION_VALUE_INVALID', 'PLAYER_POOL_INVALID', 'PLAYER_STATUS_INVALID'), label: 'Auction values and statuses valid' },
  ];
  if (!players.size) err('NO_PLAYERS', 'Players', 'No players were found in the import.');
  if (!teams.size) err('NO_TEAMS', 'Teams', 'No teams were found in the import.');

  const data = {
    teams: [...teams.values()].sort((a, b) => a.teamID - b.teamID)
      .map((t) => ({ teamID: t.teamID, name: t.name, players: [...t.members.keys()].sort((a, b) => a - b) })),
    players: sold.sort((a, b) => a.playerID - b.playerID),
  };
  return { ok: errors.length === 0, errors, warnings, info, checks, data };
}

export function hashImport(data) {
  return createHash('sha256').update(JSON.stringify(data)).digest('hex');
}

// ── database side ──────────────────────────────────────────────────────────────────────────────

const ROLE_BY_TYPE = [
  [/keep/i, 'wicketkeeper'], [/all/i, 'allrounder'], [/bowl|ball/i, 'bowler'], [/bat/i, 'batter'],
];
export function roleOf(playerType) {
  for (const [re, role] of ROLE_BY_TYPE) if (re.test(playerType || '')) return role;
  return 'batter';
}
function battingStyleOf(styles) {
  return styles.includes('Left Arm Batting') && !styles.includes('Right Arm Batting') ? 'left' : 'right';
}
function bowlingStyleOf(styles) {
  if (styles.includes('Left Arm Balling')) return 'Left-arm';
  if (styles.includes('Right Arm Balling')) return 'Right-arm';
  return undefined;
}

export function shortNameFor(name, taken) {
  const words = name.replace(/[^A-Za-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
  const first = words[0] || 'T';
  let base = /^[A-Z0-9]{2,4}$/.test(first) ? first
    : words.length > 1 ? words.map((w) => w[0]).join('').slice(0, 4) : first.slice(0, 3);
  base = base.toUpperCase();
  let s = base;
  for (let i = 2; taken.has(s); i++) s = `${base.slice(0, 4)}${i}`.slice(0, 5);
  taken.add(s);
  return s;
}

/** Comparable form of the snapshot fields an import may change (history: totals only). */
function snapshotKey(p) {
  const h = p.history || {};
  return JSON.stringify([
    p.age ?? null, p.previousSeason?.team ?? null, p.previousSeason?.points ?? null,
    totalsOf(h.previousYear), totalsOf(h.overallPrevious),
  ]);
}

/**
 * Compare validated data with the database. Adds blocking errors for conflicts.
 * links: { [playerID]: existingPlayerId } — the admin confirmed that an imported player is the same
 * person as an existing record that has no playerID (offered in the preview as a candidate; never
 * applied on a name match alone).
 */
export async function planAuctionImport(data, category, { links = {} } = {}) {
  const errors = [];
  const warnings = [];
  // Everything is compared within the target category: playerIDs, teamIDs and team names are only
  // unique per category of one season.
  const scope = { category: category._id };
  const [dbTeams, dbPlayers] = await Promise.all([
    Team.find(scope, 'name shortName teamID').lean(),
    Player.find(scope, 'name team playerID playerType playingStyle photoUrl auction age previousSeason history').lean(),
  ]);
  const teamByTid = new Map(dbTeams.filter((t) => t.teamID).map((t) => [t.teamID, t]));
  const teamByName = new Map(dbTeams.map((t) => [norm(t.name), t]));
  const teamPlan = [];
  const teamRef = new Map(); // teamID → existing _id string or null (to create)
  for (const t of data.teams) {
    const byId = teamByTid.get(t.teamID);
    const byName = teamByName.get(norm(t.name));
    if (byName && (!byId || String(byName._id) !== String(byId._id)) && byName.teamID && byName.teamID !== t.teamID) {
      errors.push({ code: 'TEAM_NAME_TAKEN', ref: `Team ${t.teamID}`, message: `"${t.name}" already exists in the scoring database as teamID ${byName.teamID}.` });
      continue;
    }
    if (byId) {
      if (byName && String(byName._id) !== String(byId._id)) {
        errors.push({ code: 'TEAM_NAME_TAKEN', ref: `Team ${t.teamID}`, message: `Renaming team ${t.teamID} to "${t.name}" clashes with another existing team.` });
        continue;
      }
      teamPlan.push({ ...t, action: byId.name === t.name ? 'unchanged' : 'update', id: String(byId._id) });
      teamRef.set(t.teamID, String(byId._id));
    } else if (byName) {
      teamPlan.push({ ...t, action: 'link', id: String(byName._id) });
      teamRef.set(t.teamID, String(byName._id));
    } else {
      teamPlan.push({ ...t, action: 'create', id: null });
      teamRef.set(t.teamID, null);
    }
  }

  // Players who already appeared in a match cannot change team (it would rewrite history).
  const appeared = new Set([
    ...(await PlayerMatchStat.distinct('player')).map(String),
    ...(await Match.distinct('playingXI.teamA')).map(String),
    ...(await Match.distinct('playingXI.teamB')).map(String),
  ]);
  const byPid = new Map(dbPlayers.filter((p) => p.playerID).map((p) => [p.playerID, p]));
  const unlinked = new Map(); // `${teamId}:${name}` → player without playerID
  for (const p of dbPlayers) if (!p.playerID) unlinked.set(`${p.team}:${norm(p.name)}`, p);

  const playerPlan = [];
  for (const p of data.players) {
    const teamId = teamRef.get(p.teamID);
    if (teamId === undefined) continue; // team had a blocking error
    let existing = byPid.get(p.playerID);
    let action;
    // A record without a playerID on the same team with the same name is only a CANDIDATE: it is
    // linked when the admin ticked it in the preview, otherwise a new record is created.
    const candidate = !existing && teamId ? unlinked.get(`${teamId}:${norm(p.name)}`) : null;
    if (existing) action = 'update';
    else if (candidate && links[p.playerID] === String(candidate._id)) { existing = candidate; action = 'link'; } else action = 'create';
    if (existing && teamId !== String(existing.team) && appeared.has(String(existing._id))) {
      errors.push({ code: 'PLAYER_TEAM_LOCKED', ref: `Player ${p.playerID}`, message: `${p.name} has already played for another team in this tournament and cannot be moved.` });
      continue;
    }
    if (action === 'update') {
      const same = existing.name === p.name && String(existing.team) === teamId && existing.playerType === p.playerType
        && (existing.photoUrl || '') === p.photoUrl && JSON.stringify(existing.playingStyle || []) === JSON.stringify(p.playingStyle)
        && existing.auction?.soldPoints === p.soldPoints && (existing.auction?.playerPool ?? null) === p.playerPool
        && snapshotKey(existing) === snapshotKey(p);
      if (same) action = 'unchanged';
    }
    // History an admin corrected by hand is never overwritten by a re-import.
    const keepHistory = existing?.history?.source === 'manual';
    if (keepHistory && p.history) {
      warnings.push({ code: 'HISTORY_MANUAL_KEPT', ref: `Player ${p.playerID}`, message: `${p.name}: previous performance was corrected by an admin and is kept; the file's values are ignored.` });
    }
    playerPlan.push({
      ...p, action, keepHistory, id: existing ? String(existing._id) : null,
      candidate: candidate && action !== 'link' ? { id: String(candidate._id), name: candidate.name } : null,
    });
  }
  const imported = new Set(data.players.map((p) => p.playerID));
  const missing = dbPlayers.filter((p) => p.playerID && !imported.has(p.playerID)).length;
  if (missing) warnings.push({ code: 'PLAYERS_NOT_IN_IMPORT', ref: 'Players', message: `${missing} player${missing === 1 ? '' : 's'} already in the scoring database ${missing === 1 ? 'is' : 'are'} not in this import and will be left unchanged.` });

  const count = (list) => list.reduce((acc, x) => ({ ...acc, [x.action]: (acc[x.action] || 0) + 1 }), {});
  return { errors, warnings, teams: teamPlan, players: playerPlan, counts: { teams: count(teamPlan), players: count(playerPlan) } };
}

/** Snapshot fields of an imported player, with the seasons the aggregates cover. */
function snapshotFields(p, category, now) {
  const fields = {
    age: p.age ?? undefined,
    previousSeason: p.previousSeason || undefined,
  };
  if (p.history && !p.keepHistory) {
    const withMeta = (block, meta) => (block ? { ...block, meta: { ...(block.meta || {}), ...meta } } : null);
    fields.history = {
      previousYear: withMeta(p.history.previousYear, { season: category.season - 1 }),
      overallPrevious: withMeta(p.history.overallPrevious, { toSeason: category.season - 2 }),
      raw: p.history.raw || undefined,
      flags: p.history.flags || [],
      source: 'auction',
      updatedAt: now,
    };
  }
  return fields;
}

export async function applyAuctionImport(plan, category) {
  const scope = { category: category._id };
  const taken = new Set((await Team.find(scope, 'shortName').lean()).map((t) => t.shortName));
  const teamIds = new Map();
  let color = (await Team.countDocuments(scope)) % TEAM_COLORS.length;
  for (const t of plan.teams) {
    if (t.action === 'create') {
      const fields = { category: category._id, name: t.name, teamID: t.teamID, shortName: shortNameFor(t.name, taken), color: TEAM_COLORS[color++ % TEAM_COLORS.length] };
      await assignNewTeamIdentity(fields);
      const doc = await Team.create(fields);
      teamIds.set(t.teamID, doc._id);
    } else {
      if (t.action !== 'unchanged') await Team.updateOne({ _id: t.id }, { $set: { name: t.name, teamID: t.teamID } });
      teamIds.set(t.teamID, new mongoose.Types.ObjectId(t.id));
    }
  }
  const now = new Date();
  const ops = [];
  const inserts = [];
  for (const p of plan.players) {
    if (p.action === 'unchanged') continue;
    const fields = {
      category: category._id,
      name: p.name,
      team: teamIds.get(p.teamID),
      playerID: p.playerID,
      playerType: p.playerType || undefined,
      playingStyle: p.playingStyle,
      photoUrl: p.photoUrl || undefined,
      auction: { soldPoints: p.soldPoints, playerPool: p.playerPool ?? undefined, status: p.status, importedAt: now },
      ...snapshotFields(p, category, now),
    };
    if (p.id) {
      ops.push({ updateOne: { filter: { _id: p.id }, update: { $set: fields } } });
    } else {
      inserts.push({ ...fields, role: roleOf(p.playerType), battingStyle: battingStyleOf(p.playingStyle), bowlingStyle: bowlingStyleOf(p.playingStyle) });
    }
  }
  // Every new season record starts as a new person; an admin links identities afterwards.
  await assignNewPlayerIdentities(inserts);
  for (const document of inserts) ops.push({ insertOne: { document } });
  if (ops.length) await Player.bulkWrite(ops, { ordered: true });
  return { teams: plan.counts.teams, players: plan.counts.players };
}
