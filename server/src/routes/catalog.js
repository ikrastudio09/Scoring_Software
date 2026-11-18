// Tournament, categories, teams and players.
import { Router } from 'express';
import mongoose from 'mongoose';
import { Match, Player, PlayerMatchStat, Team } from '../models/index.js';
import { requireAdmin } from '../middleware/auth.js';
import { validate } from '../middleware/http.js';
import * as v from '../validation.js';
import { getTournament, publicTournament, updateTournament } from '../services/tournament.js';
import { audit } from '../services/audit.js';
import { invalidateRuntime } from '../services/runtime.js';
import { invalidatePoints, getTeamRecord } from '../services/points.js';
import { invalidateStats, getPlayerCareer, getTeamStats } from '../services/stats.js';
import { conflict, notFound } from '../utils/errors.js';
import {
  categoryDetail, categoryOf, getCategory, listCategories, publicCategory, resolveCategory, updateCategory,
} from '../services/categories.js';
import { assignNewPlayerIdentities, assignNewTeamIdentity } from '../services/identities.js';
import { teamHistory } from '../services/history.js';

const router = Router();

// Public shapes: an explicit allow-list, so private fields can never leak into the API.
const teamOut = (t) => ({
  id: String(t._id), category: t.category ? String(t.category) : null, name: t.name, shortName: t.shortName, color: t.color, logoUrl: t.logoUrl, group: t.group,
  captain: t.captain ? String(t.captain) : null, homeGround: t.homeGround, teamID: t.teamID ?? null,
});
const playerOut = (p) => ({
  id: String(p._id), category: p.category ? String(p.category) : null, name: p.name, team: p.team?._id ? teamOut(p.team) : String(p.team), role: p.role,
  battingStyle: p.battingStyle, bowlingStyle: p.bowlingStyle, jerseyNumber: p.jerseyNumber, photoUrl: p.photoUrl, active: p.active,
  playerID: p.playerID ?? null, playerType: p.playerType || null, playingStyle: p.playingStyle || [],
  auction: p.auction?.status ? { soldPoints: p.auction.soldPoints ?? 0, playerPool: p.auction.playerPool ?? null, status: p.auction.status } : null,
});
const findOr404 = async (Model, id, what) => {
  if (!mongoose.isValidObjectId(id)) throw notFound(what);
  const doc = await Model.findById(id).lean();
  if (!doc) throw notFound(what);
  return doc;
};
// Names appear in cached match views and statistics; refresh them after edits.
const namesChanged = () => { invalidateRuntime(); invalidatePoints(); invalidateStats(); };

// ── tournament ──
router.get('/tournament', async (_req, res) => {
  res.json({ tournament: publicTournament(await getTournament()) });
});
router.put('/tournament', requireAdmin, validate(v.tournamentSchema), async (req, res) => {
  const t = await updateTournament(req.body);
  invalidateRuntime(); // bonus-point rules are shown on every scorecard
  invalidatePoints();
  invalidateStats(); // MVP weights may have changed
  await audit(req.user, 'tournament.update', 'tournament', t._id, req.body);
  res.json({ tournament: publicTournament(t) });
});

// ── categories ──
router.get('/categories', async (_req, res) => {
  const list = await listCategories();
  res.json({ season: list[0]?.season ?? null, categories: list.map(publicCategory) });
});
router.get('/categories/:ref', async (req, res) => {
  res.json({ category: await categoryDetail(await getCategory(req.params.ref)) });
});
router.put('/categories/:ref', requireAdmin, validate(v.categoryUpdateSchema), async (req, res) => {
  const cat = await updateCategory(await getCategory(req.params.ref), req.body);
  invalidateRuntime(); // bonus-point rules are shown on every scorecard
  invalidatePoints(cat._id);
  invalidateStats(cat._id);
  await audit(req.user, 'category.update', 'category', cat._id, req.body);
  res.json({ category: await categoryDetail(cat) });
});

// ── teams ──
router.get('/teams', validate(v.categoryQuery, 'query'), async (req, res) => {
  const category = await resolveCategory(req.validQuery.category);
  const [teams, counts] = await Promise.all([
    Team.find({ category: category._id }).sort({ name: 1 }).lean(),
    Player.aggregate([{ $match: { category: category._id, active: true } }, { $group: { _id: '$team', n: { $sum: 1 } } }]),
  ]);
  const n = Object.fromEntries(counts.map((c) => [String(c._id), c.n]));
  res.json({ teams: teams.map((t) => ({ ...teamOut(t), players: n[String(t._id)] || 0 })) });
});
router.get('/teams/:id', async (req, res) => {
  const t = await findOr404(Team, req.params.id, 'Team');
  const [players, record, stats, history] = await Promise.all([
    Player.find({ team: t._id }).sort({ name: 1 }).lean(),
    getTeamRecord(t),
    getTeamStats(t),
    teamHistory(t, await categoryOf(t)),
  ]);
  res.json({ team: { ...teamOut(t), squad: players.map(playerOut), record, stats, history } });
});
router.post('/teams', requireAdmin, validate(v.teamSchema), async (req, res) => {
  const { category: ref, ...body } = req.body;
  const category = await resolveCategory(ref);
  if (await Team.exists({ category: category._id, name: body.name })) throw conflict(`${category.name} already has a team named "${body.name}"`);
  const fields = { ...body, category: category._id };
  await assignNewTeamIdentity(fields);
  const t = await Team.create(fields);
  await audit(req.user, 'team.create', 'team', t._id, { name: t.name, category: category.key });
  namesChanged();
  res.status(201).json({ team: teamOut(t) });
});
router.put('/teams/:id', requireAdmin, validate(v.teamUpdateSchema), async (req, res) => {
  await findOr404(Team, req.params.id, 'Team');
  const t = await Team.findByIdAndUpdate(req.params.id, { $set: req.body }, { new: true, runValidators: true }).lean();
  await audit(req.user, 'team.update', 'team', t._id, req.body);
  namesChanged();
  res.json({ team: teamOut(t) });
});
router.delete('/teams/:id', requireAdmin, async (req, res) => {
  const t = await findOr404(Team, req.params.id, 'Team');
  if (await Player.exists({ team: t._id })) throw conflict('Remove or move the team’s players first');
  if (await Match.exists({ $or: [{ teamA: t._id }, { teamB: t._id }] })) throw conflict('Team has fixtures');
  await Team.deleteOne({ _id: t._id });
  await audit(req.user, 'team.delete', 'team', t._id, { name: t.name });
  namesChanged();
  res.status(204).end();
});

// ── players ──
router.get('/players', async (req, res) => {
  // A team filter implies its category; otherwise the requested (or default) category.
  const q = {};
  if (req.query.team && mongoose.isValidObjectId(req.query.team)) q.team = req.query.team;
  else q.category = (await resolveCategory(typeof req.query.category === 'string' ? req.query.category : undefined))._id;
  const players = await Player.find(q).populate('team', 'name shortName color logoUrl group').sort({ name: 1 }).lean();
  res.json({ players: players.map(playerOut) });
});
router.get('/players/:id', async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw notFound('Player');
  const p = await Player.findById(req.params.id).populate('team', 'name shortName color logoUrl group').lean();
  if (!p) throw notFound('Player');
  res.json({ player: { ...playerOut(p), ...(await getPlayerCareer(p)) } });
});
router.post('/players', requireAdmin, validate(v.playerSchema), async (req, res) => {
  const team = await findOr404(Team, req.body.team, 'Team');
  // A player always belongs to the category of their team.
  const fields = { ...req.body, category: (await categoryOf(team))._id };
  await assignNewPlayerIdentities([fields]);
  const p = await Player.create(fields);
  await audit(req.user, 'player.create', 'player', p._id, { name: p.name });
  namesChanged();
  res.status(201).json({ player: playerOut(p) });
});
router.put('/players/:id', requireAdmin, validate(v.playerUpdateSchema), async (req, res) => {
  const existing = await findOr404(Player, req.params.id, 'Player');
  if (req.body.team && String(req.body.team) !== String(existing.team)) {
    const team = await findOr404(Team, req.body.team, 'Team');
    if (String((await categoryOf(team))._id) !== String((await categoryOf(existing))._id)) {
      throw conflict('A player cannot move to a team in another category');
    }
    // Moving a player who has already appeared would rewrite history.
    if (await PlayerMatchStat.exists({ player: existing._id })
      || await Match.exists({ $or: [{ 'playingXI.teamA': existing._id }, { 'playingXI.teamB': existing._id }] })) {
      throw conflict('Player has appeared in a match and cannot change team');
    }
  }
  const p = await Player.findByIdAndUpdate(req.params.id, { $set: req.body }, { new: true, runValidators: true }).lean();
  await audit(req.user, 'player.update', 'player', p._id, req.body);
  namesChanged();
  res.json({ player: playerOut(p) });
});
router.delete('/players/:id', requireAdmin, async (req, res) => {
  const p = await findOr404(Player, req.params.id, 'Player');
  if (await Match.exists({ $or: [{ 'playingXI.teamA': p._id }, { 'playingXI.teamB': p._id }] })) {
    throw conflict('Player is in a playing XI; mark them inactive instead');
  }
  await Player.deleteOne({ _id: p._id });
  await audit(req.user, 'player.delete', 'player', p._id, { name: p.name });
  namesChanged();
  res.status(204).end();
});

export default router;
