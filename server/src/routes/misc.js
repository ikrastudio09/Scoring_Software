// Auth, home, statistics, points table, admin tools and health.
import { Router } from 'express';
import { IN_PLAY_STATUSES, MATCH_STATUS } from '@cricket/shared';
import { AuditLog, Match, User } from '../models/index.js';
import { requireAdmin, requireAuth } from '../middleware/auth.js';
import { loginLimiter, validate } from '../middleware/http.js';
import * as v from '../validation.js';
import { createUser, login, publicUser } from '../services/auth.js';
import { getTournament, publicTournament } from '../services/tournament.js';
import { listMatches } from '../services/matches.js';
import { getRuntime, liveView, cachedRuntimes } from '../services/runtime.js';
import { getActiveMatch } from '../services/active.js';
import { getCommentary } from '../services/commentary.js';
import { getLeaderboards, getMvpTable, rebuildAllStats } from '../services/stats.js';
import { getPointsTable } from '../services/points.js';
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
import { ERROR_CODES } from '@cricket/shared';

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

// ── public: home, stats, points ──
publicRouter.get('/home', async (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(await homeCache.get('home', buildHome));
});

async function buildHome() {
  const [tournament, all] = await Promise.all([getTournament(), listMatches()]);
  const live = all.filter((m) => IN_PLAY_STATUSES.includes(m.status) || m.status === MATCH_STATUS.READY);
  const liveViews = await Promise.all(live.filter((m) => m.status !== MATCH_STATUS.READY).map(async (m) => liveView(await getRuntime(m.id))));
  return {
    tournament: publicTournament(tournament),
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
// The one active match (spec §15, §53): current state + recent commentary in a single request.
// Viewers call this on open and after reconnecting, then follow socket events.
publicRouter.get('/live', async (_req, res) => {
  res.set('Cache-Control', 'no-store');
  const active = await getActiveMatch();
  if (!active) return res.json({ live: false });
  const rt = await getRuntime(active.id);
  const { entries } = await getCommentary(active.id, { limit: 12 });
  return res.json({
    live: true,
    inPlay: active.inPlay,
    matchId: active.id,
    version: rt.lastSeq,
    view: liveView(rt),
    commentary: entries,
  });
});
publicRouter.get('/points-table', async (_req, res) => { res.json(await getPointsTable()); });
publicRouter.get('/stats/leaderboards', async (_req, res) => { res.json(await getLeaderboards()); });
publicRouter.get('/stats/mvp', async (_req, res) => { res.json(await getMvpTable()); });

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
adminRouter.post('/reconcile', requireAdmin, async (req, res) => {
  const out = await reconcileMatches();
  await audit(req.user, 'matches.reconcile', 'match', null, out);
  res.json(out);
});
// ── auction / registration import: validate → preview → confirm (spec §10–§12) ──
async function importReport(body) {
  const report = validateAuctionImport(body);
  const plan = report.ok ? await planAuctionImport(report.data) : null;
  const errors = [...report.errors, ...(plan?.errors || [])];
  return {
    ok: errors.length === 0,
    hash: hashImport(report.data),
    checks: report.checks,
    errors,
    warnings: [...report.warnings, ...(plan?.warnings || [])],
    info: report.info,
    counts: plan?.counts || null,
    teams: plan ? plan.teams.map((t) => ({
      teamID: t.teamID, name: t.name, action: t.action,
      players: plan.players.filter((p) => p.teamID === t.teamID)
        .map((p) => ({ playerID: p.playerID, name: p.name, playerType: p.playerType, soldPoints: p.soldPoints, playerPool: p.playerPool, action: p.action })),
    })) : [],
    plan,
  };
}
adminRouter.post('/import/auction/preview', requireAdmin, validate(v.auctionImportSchema), async (req, res) => {
  const { plan, ...report } = await importReport(req.body);
  res.json(report);
});
adminRouter.post('/import/auction/commit', requireAdmin, validate(v.auctionImportSchema), async (req, res) => {
  const { plan, ...report } = await importReport(req.body);
  if (!report.ok) throw new AppError(422, ERROR_CODES.IMPORT_INVALID, 'The import has errors and was not applied.', report);
  if (req.body.hash && req.body.hash !== report.hash) {
    throw new AppError(409, ERROR_CODES.IMPORT_INVALID, 'The data changed since the preview. Preview it again before confirming.');
  }
  const result = await applyAuctionImport(plan);
  invalidateAllRuntimes();
  invalidatePoints();
  invalidateStats();
  await audit(req.user, 'import.auction', 'tournament', null, { hash: report.hash, ...result });
  res.json({ ok: true, hash: report.hash, result });
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
