// Auth, home, statistics, points table, admin tools and health.
import { Router } from 'express';
import { IN_PLAY_STATUSES, MATCH_STATUS } from '@cricket/shared';
import { AuditLog, Match, User } from '../models/index.js';
import { requireAdmin, requireAuth } from '../middleware/auth.js';
import { loginLimiter, validate, whatIfLimiter } from '../middleware/http.js';
import * as v from '../validation.js';
import { createUser, login, publicUser } from '../services/auth.js';
import { getTournament, publicTournament } from '../services/tournament.js';
import { listMatches } from '../services/matches.js';
import { getRuntime, liveView, cachedRuntimes } from '../services/runtime.js';
import { getActiveLock, getActiveMatch, repairActiveLock } from '../services/active.js';
import { getCategory, listCategories, publicCategory, resolveCategory } from '../services/categories.js';
import { getCommentary } from '../services/commentary.js';
import { getLeaderboards, getMvpTable, rebuildAllStats } from '../services/stats.js';
import { getPointsTable } from '../services/points.js';
import { getTournamentCentre } from '../services/centre.js';
import { getQualification, whatIf } from '../services/qualification.js';
import { categoryHistory } from '../services/history.js';
import { reconcileMatches } from '../services/scoring.js';
import { audit } from '../services/audit.js';
import { dbState, pingDb } from '../db.js';
import { metrics } from '../utils/metrics.js';
import { logger } from '../utils/logger.js';
import { ttlCache } from '../utils/ttlCache.js';
import { applyAuctionImport, hashImport, planAuctionImport, validateAuctionImport } from '../services/auctionImport.js';
import { invalidateRuntime as invalidateAllRuntimes } from '../services/runtime.js';
import { invalidatePoints } from '../services/points.js';
import { invalidateStats } from '../services/stats.js';
import { AppError } from '../utils/errors.js';
import { ERROR_CODES, totalsOf } from '@cricket/shared';

const homeCache = ttlCache(2000);

export const authRouter = Router();
export const publicRouter = Router();
export const adminRouter = Router();
export const healthRouter = Router();

// ── auth ──
authRouter.post('/login', loginLimiter, validate(v.loginSchema), async (req, res) => {
  try {
    const out = await login(req.body.username, req.body.password);
    logger.info({ username: out.user.username }, 'login');
    res.json(out);
  } catch (err) {
    logger.warn({ username: req.body.username, ip: req.ip }, 'failed login');
    throw err;
  }
});
authRouter.get('/me', requireAuth(), async (req, res) => {
  const u = await User.findById(req.user.id).lean();
  if (!u || !u.active) return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Account disabled' } });
  return res.json({ user: publicUser(u) });
});
authRouter.get('/users', requireAdmin, async (_req, res) => {
  res.json({ users: (await User.find().sort({ username: 1 }).lean()).map((u) => ({ ...publicUser(u), active: u.active, lastLoginAt: u.lastLoginAt })) });
});
authRouter.post('/users', requireAdmin, validate(v.createUserSchema), async (req, res) => {
  const user = await createUser(req.body);
  await audit(req.user, 'user.create', 'user', user.id, { username: user.username, role: user.role });
  res.status(201).json({ user });
});

/** The category a public request asked for (?category=mens|ladies|kids or id; default category). */
const categoryFrom = (req) => resolveCategory(typeof req.query.category === 'string' ? req.query.category : undefined);

// ── public: home, stats, points ──
publicRouter.get('/home', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const category = await categoryFrom(req);
  res.json(await homeCache.get(`home:${category._id}`, () => buildHome(category)));
});

/** The category's dashboard data + the one live match of the whole tournament (any category). */
async function buildHome(category) {
  const [tournament, all, active, categories] = await Promise.all([
    getTournament(), listMatches({ category }), getActiveMatch(), listCategories(),
  ]);
  const live = all.filter((m) => IN_PLAY_STATUSES.includes(m.status) || m.status === MATCH_STATUS.READY);
  const liveViews = await Promise.all(live.filter((m) => m.status !== MATCH_STATUS.READY).map(async (m) => liveView(await getRuntime(m.id))));
  const activeCategory = active?.category ? categories.find((c) => String(c._id) === active.category) : null;
  return {
    tournament: publicTournament(tournament),
    category: publicCategory(category),
    categories: categories.map(publicCategory),
    // Global LIVE indicator: may belong to another category than the one shown.
    active: active ? { matchId: active.id, number: active.number, inPlay: active.inPlay, category: activeCategory ? publicCategory(activeCategory) : null } : null,
    live: live.map((m) => ({ ...m, live: liveViews.find((l) => l.matchId === m.id) || null })),
    upcoming: all.filter((m) => [MATCH_STATUS.SCHEDULED, MATCH_STATUS.POSTPONED].includes(m.status)).slice(0, 6),
    recent: all.filter((m) => m.status === MATCH_STATUS.COMPLETED || m.status === MATCH_STATUS.ABANDONED)
      .sort((a, b) => new Date(b.completedAt || b.scheduledAt) - new Date(a.completedAt || a.scheduledAt)).slice(0, 6),
    counts: {
      total: all.length,
      completed: all.filter((m) => m.status === MATCH_STATUS.COMPLETED).length,
    },
  };
}
// The tournament landing page: every category with its next fixture and latest result, and the
// one live match (whichever category it is in).
publicRouter.get('/overview', async (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(await homeCache.get('overview', buildOverview));
});

async function buildOverview() {
  const [tournament, categories, active] = await Promise.all([getTournament(), listCategories(), getActiveMatch()]);
  const done = (m) => m.status === MATCH_STATUS.COMPLETED || m.status === MATCH_STATUS.ABANDONED;
  const rows = await Promise.all(categories.map(async (category) => {
    const all = await listMatches({ category });
    const recent = all.filter(done).sort((a, b) => new Date(b.completedAt || b.scheduledAt) - new Date(a.completedAt || a.scheduledAt));
    return {
      ...publicCategory(category),
      counts: { total: all.length, completed: all.filter((m) => m.status === MATCH_STATUS.COMPLETED).length },
      next: all.find((m) => [MATCH_STATUS.READY, MATCH_STATUS.SCHEDULED, MATCH_STATUS.POSTPONED].includes(m.status)) || null,
      last: recent[0] || null,
    };
  }));
  const activeCategory = active?.category ? categories.find((c) => String(c._id) === active.category) : null;
  return {
    tournament: publicTournament(tournament),
    categories: rows,
    active: active ? { matchId: active.id, number: active.number, inPlay: active.inPlay, category: activeCategory ? publicCategory(activeCategory) : null } : null,
  };
}

// The one active match (spec §15, §53): current state + recent commentary in a single request.
// Viewers call this on open and after reconnecting, then follow socket events.
publicRouter.get('/live', async (_req, res) => {
  res.set('Cache-Control', 'no-store');
  const active = await getActiveMatch();
  if (!active) return res.json({ live: false });
  const rt = await getRuntime(active.id);
  const { entries } = await getCommentary(active.id, { limit: 12 });
  const category = rt.match.category ? await getCategory(rt.match.category).catch(() => null) : null;
  return res.json({
    live: true,
    inPlay: active.inPlay,
    matchId: active.id,
    category: category ? publicCategory(category) : null,
    version: rt.lastSeq,
    view: liveView(rt),
    commentary: entries,
  });
});
publicRouter.get('/points-table', async (req, res) => { res.json(await getPointsTable(await categoryFrom(req))); });
publicRouter.get('/stats/leaderboards', async (req, res) => { res.json(await getLeaderboards(await categoryFrom(req))); });
publicRouter.get('/stats/mvp', async (req, res) => { res.json(await getMvpTable(await categoryFrom(req))); });
publicRouter.get('/tournament-centre', async (req, res) => { res.json(await getTournamentCentre(await categoryFrom(req))); });
publicRouter.get('/qualification', async (req, res) => { res.json(await getQualification(await categoryFrom(req))); });
// Previous seasons of one category (lazy-loaded; imported history only).
publicRouter.get('/history', async (req, res) => { res.json(await categoryHistory(await categoryFrom(req))); });
// Hypothetical results, computed in memory and discarded: nothing is ever stored.
publicRouter.post('/qualification/what-if', whatIfLimiter, validate(v.whatIfSchema), async (req, res) => {
  res.json(await whatIf(await resolveCategory(req.body.category), req.body.results));
});

// ── admin tools ──
adminRouter.get('/audit', requireAdmin, async (req, res) => {
  const q = {};
  if (req.query.entityId) q.entityId = String(req.query.entityId);
  const limit = Math.min(Number(req.query.limit) || 200, 1000);
  res.json({ entries: await AuditLog.find(q).sort({ at: -1 }).limit(limit).lean() });
});
adminRouter.post('/stats/rebuild', requireAdmin, async (req, res) => {
  const out = await rebuildAllStats();
  await audit(req.user, 'stats.rebuild', 'stats', null, out);
  res.json(out);
});
// The global one-active-match lock: inspect it, or re-derive it from the match documents.
adminRouter.get('/active-lock', requireAdmin, async (_req, res) => {
  res.json({ lock: await getActiveLock(), active: await getActiveMatch() });
});
adminRouter.post('/active-lock/repair', requireAdmin, async (req, res) => {
  const out = await repairActiveLock();
  await audit(req.user, 'active-lock.repair', 'match', out.matchId, out);
  res.json(out);
});
adminRouter.post('/reconcile', requireAdmin, async (req, res) => {
  const out = await reconcileMatches();
  await audit(req.user, 'matches.reconcile', 'match', null, out);
  res.json(out);
});
// ── auction / registration import: validate → preview → confirm (spec §10–§12) ──
async function importReport(body) {
  const category = await resolveCategory(body.category);
  const report = validateAuctionImport(body);
  // "Previous year" must really be the season before this one: a year label from another year
  // (an older export) would put last season's figures under the wrong season.
  const t = await getTournament();
  const expected = (t.startDate ? new Date(t.startDate) : new Date()).getFullYear() - 1;
  const wrongYear = (report.data?.players || []).filter((p) => /^\d{4}$/.test(p.history?.previousYear?.meta?.label || '') && Number(p.history.previousYear.meta.label) !== expected);
  if (wrongYear.length) {
    report.warnings.push({
      code: 'HISTORY_YEAR_MISMATCH', ref: `${wrongYear.length} player${wrongYear.length === 1 ? '' : 's'}`,
      message: `The previous-season figures are labelled ${[...new Set(wrongYear.map((p) => p.history.previousYear.meta.label))].join(', ')}, but the season before this one is ${expected}. Check that the export is from the right year before importing.`,
    });
  }
  const plan = report.ok ? await planAuctionImport(report.data, category, { links: body.links || {} }) : null;
  const errors = [...report.errors, ...(plan?.errors || [])];
  return {
    ok: errors.length === 0,
    // The hash covers the target category: a preview for Ladies can never be committed to Men's.
    hash: hashImport({ category: category.key, ...report.data }),
    category: publicCategory(category),
    checks: report.checks,
    errors,
    warnings: [...report.warnings, ...(plan?.warnings || [])],
    info: report.info,
    counts: plan?.counts || null,
    teams: plan ? plan.teams.map((t) => ({
      teamID: t.teamID, name: t.name, action: t.action,
      players: plan.players.filter((p) => p.teamID === t.teamID)
        .map((p) => ({
          playerID: p.playerID, name: p.name, playerType: p.playerType, soldPoints: p.soldPoints, playerPool: p.playerPool, action: p.action,
          candidate: p.candidate, previousTeam: p.previousSeason?.team || null,
          history: p.history ? {
            previousYear: totalsOf(p.history.previousYear), overallPrevious: totalsOf(p.history.overallPrevious),
            raw: p.history.raw || null, flags: p.history.flags, keptManual: p.keepHistory,
          } : null,
        })),
    })) : [],
    plan,
  };
}
adminRouter.post('/import/auction/preview', requireAdmin, validate(v.auctionImportSchema), async (req, res) => {
  const { plan, ...report } = await importReport(req.body);
  res.json(report);
});
adminRouter.post('/import/auction/commit', requireAdmin, validate(v.auctionImportSchema), async (req, res) => {
  const { plan, category, ...report } = await importReport(req.body);
  if (!report.ok) throw new AppError(422, ERROR_CODES.IMPORT_INVALID, 'The import has errors and was not applied.', report);
  if (req.body.hash && req.body.hash !== report.hash) {
    throw new AppError(409, ERROR_CODES.IMPORT_INVALID, 'The data changed since the preview. Preview it again before confirming.');
  }
  const result = await applyAuctionImport(plan, await getCategory(category.id));
  invalidateAllRuntimes();
  invalidatePoints(category.id);
  invalidateStats(category.id);
  await audit(req.user, 'import.auction', 'category', category.id, { hash: report.hash, category: category.key, ...result });
  res.json({ ok: true, hash: report.hash, category, result });
});

adminRouter.get('/metrics', requireAdmin, async (_req, res) => {
  res.json(metrics.snapshot({
    db: { state: dbState() },
    runtimes: cachedRuntimes().map((rt) => ({ matchId: rt.id, status: rt.match.status, version: rt.lastSeq })),
  }));
});

// ── health (for load balancers / uptime monitors) ──
healthRouter.get('/health', async (_req, res) => {
  let dbPingMs = null;
  let ok = dbState() === 'connected';
  if (ok) {
    try { dbPingMs = await pingDb(); } catch { ok = false; }
  }
  const m = metrics.snapshot();
  res.status(ok ? 200 : 503).json({
    status: ok ? 'ok' : 'degraded',
    db: { state: dbState(), pingMs: dbPingMs },
    uptimeSec: m.uptimeSec,
    sockets: m.sockets.connected,
    memoryMb: m.memoryMb.rss,
    inPlayMatches: await Match.countDocuments({ status: { $in: IN_PLAY_STATUSES } }).catch(() => null),
    activeMatchId: (await getActiveMatch().catch(() => null))?.id ?? null,
  });
});
