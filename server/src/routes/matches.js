import { Router } from 'express';
import { EVENT_TYPES } from '@cricket/shared';
import { requireAdmin, requireScorer } from '../middleware/auth.js';
import { validate } from '../middleware/http.js';
import * as v from '../validation.js';
import * as matches from '../services/matches.js';
import { executeCommand } from '../services/scoring.js';
import { getRuntime, liveView, scorecard, scorerView } from '../services/runtime.js';
import { ttlCache } from '../utils/ttlCache.js';

const listCache = ttlCache(2000);

const router = Router();
const noStore = (res) => res.set('Cache-Control', 'no-store');

// ── public, read-only ──
router.get('/', validate(v.matchListQuery, 'query'), async (req, res) => {
  // Anonymous viewers share a 2 s cache; signed-in staff always get fresh data.
  const load = () => matches.listMatches(req.validQuery);
  const list = req.headers.authorization ? await load() : await listCache.get(JSON.stringify(req.validQuery), load);
  res.json({ matches: list });
});

router.get('/:id', async (req, res) => {
  res.json({ match: await matches.getMatch(req.params.id) });
});

router.get('/:id/live', async (req, res) => {
  matches.assertObjectId(req.params.id, 'Match');
  noStore(res);
  res.json({ live: liveView(await getRuntime(req.params.id)) });
});

router.get('/:id/scorecard', async (req, res) => {
  matches.assertObjectId(req.params.id, 'Match');
  noStore(res);
  res.json({ scorecard: scorecard(await getRuntime(req.params.id)) });
});

// ── scorer / admin ──
router.get('/:id/scorer', requireScorer, async (req, res) => {
  matches.assertObjectId(req.params.id, 'Match');
  noStore(res);
  res.json({ view: scorerView(await getRuntime(req.params.id)) });
});

router.get('/:id/events', requireScorer, async (req, res) => {
  res.json({ events: await matches.listEvents(req.params.id) });
});

router.get('/:id/player-of-match-suggestion', requireScorer, async (req, res) => {
  matches.assertObjectId(req.params.id, 'Match');
  res.json({ suggestion: await matches.playerOfMatchSuggestion(req.params.id) });
});

router.post('/', requireAdmin, validate(v.matchCreateSchema), async (req, res) => {
  res.status(201).json({ match: await matches.createMatch(req.body, req.user) });
});

router.put('/:id', requireAdmin, validate(v.matchUpdateSchema), async (req, res) => {
  matches.assertObjectId(req.params.id, 'Match');
  res.json({ match: await matches.updateMatch(req.params.id, req.body, req.user) });
});

router.delete('/:id', requireAdmin, async (req, res) => {
  matches.assertObjectId(req.params.id, 'Match');
  await matches.deleteMatch(req.params.id, req.user);
  res.status(204).end();
});

router.post('/:id/setup', requireScorer, validate(v.matchSetupSchema), async (req, res) => {
  matches.assertObjectId(req.params.id, 'Match');
  res.json({ match: await matches.setupMatch(req.params.id, req.body, req.user) });
});

router.post('/:id/status', requireAdmin, validate(v.matchStatusSchema), async (req, res) => {
  matches.assertObjectId(req.params.id, 'Match');
  res.json({ match: await matches.changeStatus(req.params.id, req.body, req.user) });
});

router.post('/:id/confirm-result', requireScorer, validate(v.confirmSchema), async (req, res) => {
  matches.assertObjectId(req.params.id, 'Match');
  res.json({ match: await matches.confirmResult(req.params.id, req.body, req.user) });
});

router.post('/:id/reopen', requireAdmin, validate(v.reopenSchema), async (req, res) => {
  matches.assertObjectId(req.params.id, 'Match');
  res.json({ match: await matches.reopenMatch(req.params.id, req.body, req.user) });
});

// ── scoring commands (domain operations, never raw field edits) ──
const command = (path, schema, type) => {
  router.post(path, requireScorer, validate(schema), async (req, res) => {
    matches.assertObjectId(req.params.id, 'Match');
    const { clientEventId, expectedVersion, ...payload } = req.body;
    noStore(res);
    res.json(await executeCommand(req.params.id, { type, payload, clientEventId, expectedVersion }, req.user));
  });
};

command('/:id/innings/start', v.startInningsSchema, EVENT_TYPES.START_INNINGS);
command('/:id/deliveries', v.deliverySchema, EVENT_TYPES.DELIVERY);
command('/:id/bowler', v.setBowlerSchema, EVENT_TYPES.SET_BOWLER);
command('/:id/batter', v.newBatterSchema, EVENT_TYPES.NEW_BATTER);
command('/:id/retire', v.retireSchema, EVENT_TYPES.RETIRE);
command('/:id/swap-strike', v.plainCommandSchema, EVENT_TYPES.SWAP_STRIKE);
command('/:id/innings/end', v.endInningsSchema, EVENT_TYPES.END_INNINGS);
command('/:id/conclude', v.concludeSchema, EVENT_TYPES.CONCLUDE);
command('/:id/undo', v.plainCommandSchema, EVENT_TYPES.UNDO);

export default router;
