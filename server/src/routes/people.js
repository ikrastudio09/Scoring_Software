// Admin maintenance of season player records (private snapshot fields, historical aggregates) and
// of permanent player / team identities. Mounted under /api/admin; every route requires an admin.
import { Router } from 'express';
import mongoose from 'mongoose';
import { ERROR_CODES, totalsOf } from '@cricket/shared';
import { HistoricalImport, Player } from '../models/index.js';
import { requireAdmin } from '../middleware/auth.js';
import { validate } from '../middleware/http.js';
import * as v from '../validation.js';
import { resolveCategory } from '../services/categories.js';
import { audit } from '../services/audit.js';
import {
  getPlayerIdentity, linkPlayerIdentity, linkTeamIdentity, playerIdentityReview, searchPlayerIdentities, teamIdentityReview,
} from '../services/identities.js';
import { invalidateStats } from '../services/stats.js';
import { getTournament } from '../services/tournament.js';
import { invalidateHistory } from '../services/history.js';
import {
  FIELDS, applyHistory, guessMapping, hashHistory, planHistory, undoHistoryImport, validateHistory,
} from '../services/historyImport.js';
import { AppError, notFound } from '../utils/errors.js';

const router = Router();
router.use(requireAdmin);

const categoryFrom = (req) => resolveCategory(typeof req.query.category === 'string' ? req.query.category : undefined);

/** Admin shape: includes the private age, never a phone number (not stored). */
const adminPlayerOut = (p) => ({
  id: String(p._id), name: p.name, playerID: p.playerID ?? null, team: p.team?.name ? { id: String(p.team._id), name: p.team.name } : null,
  identity: p.identity ? String(p.identity) : null, age: p.age ?? null, previousSeason: p.previousSeason?.team || p.previousSeason?.points ? p.previousSeason : null,
  history: p.history?.source ? {
    previousYear: p.history.previousYear || null, overallPrevious: p.history.overallPrevious || null,
    raw: p.history.raw || null, flags: p.history.flags || [], source: p.history.source, updatedAt: p.history.updatedAt, updatedBy: p.history.updatedBy || null,
  } : null,
});

router.get('/players', async (req, res) => {
  const category = await categoryFrom(req);
  const players = await Player.find({ category: category._id }).populate('team', 'name').sort({ name: 1 }).lean();
  res.json({ category: { key: category.key, name: category.name, season: category.season }, players: players.map(adminPlayerOut) });
});

/** Strip nulls/empties from an edited aggregate; null when nothing is left. */
function cleanBlock(b) {
  if (!b) return null;
  const out = totalsOf(b);
  const supplied = Object.fromEntries(Object.entries(b.supplied || {}).filter(([, x]) => x !== null && x !== undefined));
  if (Object.keys(supplied).length) out.supplied = supplied;
  if (b.meta && Object.keys(b.meta).length) out.meta = b.meta;
  return Object.keys(totalsOf(out)).length || out.supplied ? out : null;
}

// Correct the historical aggregates by hand. Marked "manual" so a later re-import keeps them.
router.put('/players/:id/history', validate(v.historyUpdateSchema), async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw notFound('Player');
  const p = await Player.findById(req.params.id).lean();
  if (!p) throw notFound('Player');
  const { reason, previousSeason, ...blocks } = req.body;
  const set = {};
  for (const k of ['previousYear', 'overallPrevious']) if (blocks[k] !== undefined) set[`history.${k}`] = cleanBlock(blocks[k]);
  if (Object.keys(set).length) Object.assign(set, { 'history.source': 'manual', 'history.updatedAt': new Date(), 'history.updatedBy': req.user.username, 'history.flags': [] });
  if (previousSeason !== undefined) set.previousSeason = previousSeason;
  await Player.updateOne({ _id: p._id }, { $set: set }, { runValidators: true });
  await audit(req.user, 'player.history', 'player', p._id, {
    reason, before: { previousYear: p.history?.previousYear || null, overallPrevious: p.history?.overallPrevious || null, previousSeason: p.previousSeason || null }, after: req.body,
  });
  invalidateStats(p.category);
  res.json({ player: adminPlayerOut(await Player.findById(p._id).populate('team', 'name').lean()) });
});

// ── identities ──
router.get('/identities/players', async (req, res) => {
  res.json({ players: await playerIdentityReview(await categoryFrom(req)) });
});
router.get('/identities/players/search', async (req, res) => {
  res.json({ identities: await searchPlayerIdentities(String(req.query.q || '')) });
});
router.get('/identities/players/:id', async (req, res) => {
  res.json({ identity: await getPlayerIdentity(req.params.id) });
});
router.post('/players/:id/identity', validate(v.identityLinkSchema), async (req, res) => {
  const out = await linkPlayerIdentity(req.params.id, req.body.identityId, req.user);
  invalidateHistory();
  res.json({ identity: out });
});
router.get('/identities/teams', async (req, res) => {
  res.json({ teams: await teamIdentityReview(await categoryFrom(req)) });
});
router.post('/teams/:id/identity', validate(v.identityLinkSchema), async (req, res) => {
  const out = await linkTeamIdentity(req.params.id, req.body.identityId, req.user);
  invalidateHistory();
  res.json({ identity: out });
});

// ── historical records: upload → map columns → validate → preview → confirm → summary / undo ──
router.get('/import/history/fields', (_req, res) => {
  res.json({ fields: Object.fromEntries(Object.entries(FIELDS).map(([k, list]) => [k, list.map((f) => ({ key: f.key, required: Boolean(f.required) }))])) });
});
router.post('/import/history/guess', (req, res) => {
  const kind = req.body?.kind === 'teams' ? 'teams' : 'players';
  const columns = Array.isArray(req.body?.columns) ? req.body.columns.map(String).slice(0, 200) : [];
  res.json({ mapping: guessMapping(kind, columns) });
});

async function historyReport(body) {
  const t = await getTournament();
  const valid = validateHistory({ ...body, currentSeason: t.currentSeason });
  const plan = valid.ok ? await planHistory(valid, { kind: body.kind, choices: body.choices || {}, overwrite: Boolean(body.overwrite) }) : null;
  const errors = [...valid.errors, ...(plan?.errors || [])];
  const hash = hashHistory({ kind: body.kind, rows: valid.rows, choices: plan?.groups.map((g) => [g.key, g.choice]), overwrite: Boolean(body.overwrite) });
  return {
    ok: errors.length === 0, hash, errors, warnings: [...valid.warnings, ...(plan?.warnings || [])],
    counts: plan?.counts || null, rowCount: valid.rows.length,
    groups: plan ? plan.groups.map((g) => ({
      key: g.key, name: g.name, choice: g.choice, suggestions: g.suggestions,
      rows: g.rows.map((r) => ({
        row: r.row, season: r.season, categoryKey: r.categoryKey, action: r.action, team: r.teamName || null,
        totals: r.performance ? totalsOf(r.performance) : undefined, champion: r.champion, finalist: r.finalist, matches: r.matches, won: r.won, points: r.points,
      })),
    })) : [],
    plan,
  };
}
router.post('/import/history/preview', validate(v.historyImportSchema), async (req, res) => {
  const { plan, ...report } = await historyReport(req.body);
  res.json(report);
});
router.post('/import/history/commit', validate(v.historyImportSchema), async (req, res) => {
  const { plan, ...report } = await historyReport(req.body);
  if (!report.ok) throw new AppError(422, ERROR_CODES.IMPORT_INVALID, 'The import has errors and was not applied.', report);
  if (req.body.hash !== report.hash) throw new AppError(409, ERROR_CODES.IMPORT_INVALID, 'The data or your choices changed since the preview. Preview again before confirming.');
  const result = await applyHistory(plan, { kind: req.body.kind, categoryKey: req.body.category, fileName: req.body.fileName, hash: report.hash }, req.user);
  invalidateHistory();
  invalidateStats();
  await audit(req.user, 'import.history', 'history', result.importId, { kind: req.body.kind, fileName: req.body.fileName, ...result });
  res.json({ ok: true, result });
});
router.get('/import/history', async (_req, res) => {
  res.json({ imports: await HistoricalImport.find({}, '-replaced').sort({ createdAt: -1 }).limit(100).lean() });
});
router.delete('/import/history/:id', async (req, res) => {
  const out = await undoHistoryImport(req.params.id, req.user);
  if (!out) throw notFound('Import');
  invalidateHistory();
  invalidateStats();
  await audit(req.user, 'import.history.undo', 'history', req.params.id, out);
  res.json(out);
});

export default router;
