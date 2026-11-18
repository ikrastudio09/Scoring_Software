// Men's / Ladies / Kids separation and the GLOBAL one-active-match lock (database level), through
// the real HTTP API.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ActiveLock, Match, Team } from '../../src/models/index.js';
import { claimActiveLock, releaseActiveLock, repairActiveLock } from '../../src/services/active.js';
import { getCategory, migrateLegacyData } from '../../src/services/categories.js';
import { invalidateRuntime } from '../../src/services/runtime.js';
import { auth, bootServer, finishActiveMatches, scorer, seedMatch } from './harness.js';

let ctx;
beforeAll(async () => { ctx = await bootServer(); });
afterAll(async () => { await ctx?.close(); });

const admin = () => auth(ctx.adminToken);

/** Play a complete 1-over match (team A bats first and wins) and confirm it. */
async function playAndConfirm(m, s = scorer(ctx, m.id)) {
  await s.start(m.A.players[0], m.A.players[1], m.B.players[0]);
  await s.over(null, [4, 4, 1, 1, 0, 6]);
  await s.start(m.B.players[0], m.B.players[1], m.A.players[0]);
  await s.over(null, [0, 0, 1, 0, 0, 0]);
  await ctx.http.post(`/api/matches/${m.id}/confirm-result`).set(auth(ctx.scorerToken)).send({}).expect(200);
}

describe('categories', () => {
  it('lists the three categories of the current season', async () => {
    const { body } = await ctx.http.get('/api/categories').expect(200);
    expect(body.season).toBe(21);
    expect(body.categories.map((c) => c.key)).toEqual(['mens', 'ladies', 'kids']);
    await ctx.http.get('/api/points-table?category=veterans').expect(404);
  });

  it('keeps teams, fixtures, points tables and leaderboards independent per category', async () => {
    await finishActiveMatches();
    const men = await seedMatch(ctx, { overs: 1, category: 'mens' });
    await playAndConfirm(men);
    const ladies = await seedMatch(ctx, { overs: 1, category: 'ladies' });

    // match numbers restart per category
    expect(men.match.number).toBe(1);
    expect(ladies.match.number).toBe(1);

    // the same team name may exist in two categories, but not twice in one
    await ctx.http.post('/api/teams').set(admin()).send({ name: men.A.name, shortName: 'X', category: 'ladies' }).expect(201);
    await ctx.http.post('/api/teams').set(admin()).send({ name: men.A.name, shortName: 'X', category: 'mens' }).expect(409);

    // a fixture cannot pair teams from two categories
    await ctx.http.post('/api/matches').set(admin()).send({ teamA: men.A.id, teamB: ladies.A.id, category: 'mens' }).expect(400);
    // a player cannot move to another category's team
    await ctx.http.put(`/api/players/${men.A.players[5]}`).set(admin()).send({ team: ladies.A.id }).expect(409);

    const tableOf = async (c) => (await ctx.http.get(`/api/points-table?category=${c}`).expect(200)).body;
    const menTable = await tableOf('mens');
    const ladiesTable = await tableOf('ladies');
    const teamsIn = (t) => t.groups.flatMap((g) => g.rows.map((r) => r.team.id));
    expect(teamsIn(menTable)).toEqual(expect.arrayContaining([men.A.id, men.B.id]));
    expect(teamsIn(menTable)).not.toContain(ladies.A.id);
    expect(teamsIn(ladiesTable)).not.toContain(men.A.id);
    expect(menTable.groups.flatMap((g) => g.rows).find((r) => r.team.id === men.A.id).points).toBeGreaterThan(0);
    expect(ladiesTable.groups.flatMap((g) => g.rows).every((r) => r.played === 0)).toBe(true);

    // leaderboards: Men's runs never appear in the Ladies leaderboard
    await new Promise((r) => setTimeout(r, 300)); // stats rebuild runs after confirmation
    const lbMen = (await ctx.http.get('/api/stats/leaderboards?category=mens').expect(200)).body;
    const lbLadies = (await ctx.http.get('/api/stats/leaderboards?category=ladies').expect(200)).body;
    expect(lbMen.mostRuns.length).toBeGreaterThan(0);
    expect(lbLadies.mostRuns).toHaveLength(0);
    expect(lbLadies.totals.runs).toBe(0);
    expect((await ctx.http.get('/api/stats/mvp?category=ladies').expect(200)).body.players).toHaveLength(0);

    // lists are scoped; a request without a category gets Men's (installed apps keep working)
    const ids = (r) => r.body.matches.map((m) => m.id);
    expect(ids(await ctx.http.get('/api/matches?category=ladies').expect(200))).toEqual([ladies.id]);
    expect(ids(await ctx.http.get('/api/matches').expect(200))).toContain(men.id);
    expect(ids(await ctx.http.get('/api/matches').expect(200))).not.toContain(ladies.id);
    expect((await ctx.http.get('/api/teams?category=ladies').expect(200)).body.teams.map((t) => t.name)).not.toContain(men.B.name);
  });

  it('applies category rule overrides on top of the season defaults', async () => {
    await ctx.http.put('/api/categories/kids').set(auth(ctx.scorerToken)).send({ rules: { oversPerInnings: 6 } }).expect(403);
    const { body } = await ctx.http.put('/api/categories/kids').set(admin()).send({ rules: { oversPerInnings: 6 }, qualification: { slots: 2 } }).expect(200);
    expect(body.category.effective.rules.oversPerInnings).toBe(6);
    expect(body.category.effective.qualification.slots).toBe(2);
    const kid = (n) => ctx.http.post('/api/teams').set(admin()).send({ name: `Kids ${n}`, shortName: `K${n}`, category: 'kids' }).expect(201);
    const [a, b] = [(await kid(1)).body.team, (await kid(2)).body.team];
    const m = (await ctx.http.post('/api/matches').set(admin()).send({ teamA: a.id, teamB: b.id, category: 'kids' }).expect(201)).body.match;
    expect(m.rules.oversPerInnings).toBe(6);
    // null returns the group to the season defaults
    const reset = (await ctx.http.put('/api/categories/kids').set(admin()).send({ rules: null }).expect(200)).body.category;
    expect(reset.overrides.rules).toEqual({});
  });

  it('assigns documents created before categories to the default category', async () => {
    await Team.collection.insertOne({ name: 'Legacy XI', shortName: 'LEG', color: '#334155' });
    await migrateLegacyData();
    const legacy = await Team.findOne({ name: 'Legacy XI' }).lean();
    expect(String(legacy.category)).toBe(String((await getCategory('mens'))._id));
  });
});

describe('one live match across all categories', () => {
  it('a live Men\'s match blocks a Ladies match, with a clear error naming the category', async () => {
    await finishActiveMatches();
    const men = await seedMatch(ctx, { overs: 1, category: 'mens' });
    const ladies = await seedMatch(ctx, { overs: 1, category: 'ladies' });
    await scorer(ctx, men.id).start(men.A.players[0], men.A.players[1], men.B.players[0]);

    const res = await ctx.http.post(`/api/matches/${ladies.id}/innings/start`).set(auth(ctx.scorerToken))
      .send({ clientEventId: 'ladies-start-1', expectedVersion: 0, strikerId: ladies.A.players[0], nonStrikerId: ladies.A.players[1], bowlerId: ladies.B.players[0] })
      .expect(409);
    expect(res.body.error.code).toBe('ANOTHER_MATCH_ACTIVE');
    expect(res.body.error.message).toMatch(/Men's Match \d+ is currently live/);
    expect(res.body.error.details.activeCategory.key).toBe('mens');

    // the global indicator says which category is live, from any category's page
    const live = (await ctx.http.get('/api/live').expect(200)).body;
    expect(live.category.key).toBe('mens');
    const home = (await ctx.http.get('/api/home?category=ladies').expect(200)).body;
    expect(home.category.key).toBe('ladies');
    expect(home.active).toMatchObject({ matchId: men.id, category: { key: 'mens' } });

    const lock = await ActiveLock.findById('global').lean();
    expect(String(lock.matchId)).toBe(men.id);
  });

  it('simultaneous starts in two categories: exactly one wins', async () => {
    await finishActiveMatches();
    const men = await seedMatch(ctx, { overs: 1, category: 'mens' });
    const kids = await seedMatch(ctx, { overs: 1, category: 'kids' });
    const results = await Promise.allSettled([
      scorer(ctx, men.id).start(men.A.players[0], men.A.players[1], men.B.players[0]),
      scorer(ctx, kids.id).start(kids.A.players[0], kids.A.players[1], kids.B.players[0]),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await Match.countDocuments({ status: { $in: ['LIVE', 'INNINGS_BREAK', 'SECOND_INNINGS'] } })).toBe(1);
  });

  it('the database lock refuses a second claim even when the in-process checks are bypassed', async () => {
    await finishActiveMatches();
    const lock = await ActiveLock.findById('global').lean();
    expect(lock.matchId).toBeNull(); // released by confirmation

    const a = await seedMatch(ctx, { overs: 1, category: 'mens' });
    const b = await seedMatch(ctx, { overs: 1, category: 'ladies' });
    const [ma, mb] = await Promise.all([Match.findById(a.id).lean(), Match.findById(b.id).lean()]);
    // As two processes would: both try to claim at the same moment.
    const claims = await Promise.allSettled([claimActiveLock(ma), claimActiveLock(mb)]);
    expect(claims.filter((c) => c.status === 'fulfilled')).toHaveLength(1);
    const rejected = claims.find((c) => c.status === 'rejected').reason;
    expect(rejected.code).toBe('ANOTHER_MATCH_ACTIVE');
    // re-claiming by the holder is fine (idempotent); release only works for the holder
    const holder = claims[0].status === 'fulfilled' ? ma : mb;
    const other = holder === ma ? mb : ma;
    expect(await claimActiveLock(holder)).toBe(false);
    await releaseActiveLock(other._id);
    expect(String((await ActiveLock.findById('global').lean()).matchId)).toBe(String(holder._id));
    await releaseActiveLock(holder._id);
    expect((await ActiveLock.findById('global').lean()).matchId).toBeNull();
  });

  it('undoing the opening START_INNINGS releases the lock; confirmation releases it', async () => {
    await finishActiveMatches();
    const m = await seedMatch(ctx, { overs: 1, category: 'kids' });
    const s = scorer(ctx, m.id);
    await s.start(m.A.players[0], m.A.players[1], m.B.players[0]);
    expect(String((await ActiveLock.findById('global').lean()).matchId)).toBe(m.id);
    await s.undo();
    expect((await ActiveLock.findById('global').lean()).matchId).toBeNull();
    await playAndConfirm(m, s);
    expect((await ActiveLock.findById('global').lean()).matchId).toBeNull();
  });

  it('repairs a stale lock from the match documents (e.g. after a crash)', async () => {
    await finishActiveMatches();
    const m = await seedMatch(ctx, { overs: 1, category: 'mens' });
    await scorer(ctx, m.id).start(m.A.players[0], m.A.players[1], m.B.players[0]);
    // corrupt the lock: points at a match that does not exist
    await ActiveLock.updateOne({ _id: 'global' }, { $set: { matchId: '0123456789abcdef01234567' } });
    expect((await repairActiveLock()).matchId).toBe(m.id);
    // lock lost entirely
    await ActiveLock.deleteOne({ _id: 'global' });
    expect((await repairActiveLock()).matchId).toBe(m.id);
    // the repaired lock still blocks any other match
    const ghost = { _id: '0123456789abcdef01234568', number: 99, category: null };
    await expect(claimActiveLock(ghost)).rejects.toMatchObject({ code: 'ANOTHER_MATCH_ACTIVE' });
  });
});

describe('admin lock endpoints', () => {
  it('inspects and repairs the lock (admin only)', async () => {
    await ctx.http.get('/api/admin/active-lock').set(auth(ctx.scorerToken)).expect(403);
    const { body } = await ctx.http.get('/api/admin/active-lock').set(admin()).expect(200);
    expect(body).toHaveProperty('lock');
    await ctx.http.post('/api/admin/active-lock/repair').set(admin()).expect(200);
    invalidateRuntime();
  });
});
