// Phase 8 through the API: historical import workflow (preview → identity choices → confirm),
// profiles and careers without double counting, team history, category history, undo.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HistoricalPlayerSeason, Player, Team } from '../../src/models/index.js';
import { auth, bootServer, seedMatch } from './harness.js';

let ctx;
let m;
const admin = () => auth(ctx.adminToken);
const post = (path, body, expect = 200) => ctx.http.post(`/api/admin/import/history/${path}`).set(admin()).send(body).expect(expect);

const playerRows = (name) => [
  { Player: name, Season: '19', Team: 'Old Lions', M: '6', Runs: '120', Wkts: '3', Ct: '1', MVP: 'yes' },
  { Player: name, Season: '20', Team: 'Old Lions', M: '7', Runs: '80', Wkts: '5', Ct: '2' },
  { Player: 'Only History Guy', Season: '18', Team: 'Old Lions', M: '4', Runs: '300', Wkts: '0' },
];
const MAPPING = { name: 'Player', season: 'Season', team: 'Team', matches: 'M', runs: 'Runs', wickets: 'Wkts', catches: 'Ct', mvp: 'MVP' };

beforeAll(async () => {
  ctx = await bootServer();
  m = await seedMatch(ctx, { overs: 1 });
});
afterAll(async () => { await ctx?.close(); });

describe('historical player seasons', () => {
  let target;
  let preview;
  const body = (extra = {}) => ({ kind: 'players', category: 'mens', fileName: 'mens-history.csv', rows: playerRows('A Player 1'), mapping: MAPPING, ...extra });

  it('guesses the column mapping and previews with identity suggestions (never applied by itself)', async () => {
    const g = (await post('guess', { kind: 'players', columns: Object.keys(playerRows('x')[0]) })).body.mapping;
    expect(g).toMatchObject({ name: 'Player', season: 'Season', team: 'Team', matches: 'M', runs: 'Runs', wickets: 'Wkts', catches: 'Ct', mvp: 'MVP' });
    target = await Player.findById(m.A.players[0]).lean();
    preview = (await post('preview', body())).body;
    expect(preview.ok).toBe(true);
    const group = preview.groups.find((x) => x.name === 'A Player 1');
    expect(group.choice).toBe('new');
    expect(group.suggestions.map((s) => s.id)).toContain(String(target.identity));
    expect(preview.counts).toMatchObject({ create: 3, newIdentities: 2 });
  });

  it('only admins; a confirmation must match the previewed choices', async () => {
    await ctx.http.post('/api/admin/import/history/preview').set(auth(ctx.scorerToken)).send(body()).expect(403);
    const key = preview.groups.find((x) => x.name === 'A Player 1').key;
    // previewed with "new", confirmed with a link: rejected
    await post('commit', body({ hash: preview.hash, choices: { [key]: String(target.identity) } }), 409);
  });

  it('linking to the current-season player: the profile shows the seasons and a career counted once', async () => {
    const key = preview.groups.find((x) => x.name === 'A Player 1').key;
    const choices = { [key]: String(target.identity) };
    const p2 = (await post('preview', body({ choices }))).body;
    expect(p2.counts).toMatchObject({ create: 3, newIdentities: 1 });
    const res = (await post('commit', body({ choices, hash: p2.hash }))).body;
    expect(res.result).toMatchObject({ create: 3 });

    // The auction says: last season (20) 10 matches / 41 runs, before that 53 / 339 (to season 19).
    await ctx.http.put(`/api/admin/players/${target._id}/history`).set(admin()).send({
      previousYear: { seasons: 1, matches: 10, runs: 41 }, overallPrevious: { seasons: 9, matches: 53, runs: 339 }, reason: 'test',
    }).expect(200);
    const p = (await ctx.http.get(`/api/players/${target._id}`).expect(200)).body.player;
    expect(p.history.seasons.map((x) => [x.season, x.source, x.totals.runs])).toEqual([[20, 'imported', 80], [19, 'imported', 120]]);
    expect(p.history.seasons[1].mvpAward).toBe(true);
    // Season 20: the imported row replaces the auction figure. Seasons ≤19: the imported row covers
    // 1 of the 9 seasons in the auction total, so the total is used and the row is not added again.
    expect(p.history.career.totals).toMatchObject({ matches: 7 + 53, runs: 80 + 339 });
    expect(p.history.career.notes.join(' ')).toMatch(/Season 20 is counted from its season record.*cover only part of the auction total/);
  });

  it('re-importing skips existing rows unless "replace" is confirmed; undo restores what was replaced', async () => {
    const key = preview.groups.find((x) => x.name === 'A Player 1').key;
    const choices = { [key]: String(target.identity) };
    const again = (await post('preview', body({ choices }))).body;
    expect(again.counts).toMatchObject({ skip: 2, create: 1 }); // "Only History Guy" is new again (no link chosen)
    expect(again.warnings.some((w) => /already imported/.test(w.message))).toBe(true);

    const changed = body({ choices, overwrite: true, rows: playerRows('A Player 1').map((r) => (r.Season === '20' ? { ...r, Runs: '85' } : r)).slice(0, 2) });
    const pv = (await post('preview', changed)).body;
    expect(pv.counts).toMatchObject({ replace: 2 });
    const done = (await post('commit', { ...changed, hash: pv.hash })).body;
    expect((await HistoricalPlayerSeason.findOne({ identity: target.identity, season: 20 }).lean()).performance.runs).toBe(85);

    const undo = (await ctx.http.delete(`/api/admin/import/history/${done.result.importId}`).set(admin()).expect(200)).body;
    expect(undo).toEqual({ removed: 2, restored: 2 });
    expect((await HistoricalPlayerSeason.findOne({ identity: target.identity, season: 20 }).lean()).performance.runs).toBe(80);
    const list = (await ctx.http.get('/api/admin/import/history').set(admin()).expect(200)).body.imports;
    expect(list.find((i) => i._id === done.result.importId).undoneAt).toBeTruthy();
  });

  it('refuses rows for the season scored in this system', async () => {
    const r = (await post('preview', body({ rows: [{ Player: 'Z', Season: '21', Runs: '3' }] }))).body;
    expect(r.ok).toBe(false);
    expect(r.errors[0].message).toMatch(/scored in this system/);
  });
});

describe('historical team seasons and the category history', () => {
  it('team history on the profile and previous seasons in the Tournament Centre data', async () => {
    const team = await Team.findById(m.A.id).lean();
    const rows = [
      { Team: 'Old Lions', Season: '19', P: '6', W: '5', L: '1', Pts: '10', Champion: 'yes', Highest: '150' },
      { Team: 'Old Lions', Season: '20', P: '6', W: '3', L: '3', Pts: '6', Position: '4' },
      { Team: 'Tigers', Season: '19', P: '6', W: '4', L: '2', Finalist: 'yes' },
    ];
    const mapping = { name: 'Team', season: 'Season', matches: 'P', won: 'W', lost: 'L', points: 'Pts', champion: 'Champion', finalist: 'Finalist', highestScore: 'Highest', position: 'Position' };
    const first = (await post('preview', { kind: 'teams', category: 'mens', rows, mapping })).body;
    const key = first.groups.find((g) => g.name === 'Old Lions').key;
    const choices = { [key]: String(team.identity) }; // this season's team A is the same franchise
    const pv = (await post('preview', { kind: 'teams', category: 'mens', rows, mapping, choices })).body;
    await post('commit', { kind: 'teams', category: 'mens', rows, mapping, choices, hash: pv.hash });

    const t = (await ctx.http.get(`/api/teams/${m.A.id}`).expect(200)).body.team;
    expect(t.history.summary).toMatchObject({ seasons: 2, titles: 1, finals: 1, matches: 12, won: 8, winPct: 66.7, bestFinish: 4, highestScore: 150 });
    expect(t.history.seasons.map((s) => s.season)).toEqual([20, 19]);

    const h = (await ctx.http.get('/api/history?category=mens').expect(200)).body;
    expect(h.available).toBe(true);
    const s19 = h.seasons.find((s) => s.season === 19);
    expect(s19).toMatchObject({ champion: ['Old Lions'], runnerUp: ['Tigers'] });
    expect(s19.topRunScorer.map((p) => [p.name, p.value])).toEqual([['A Player 1', 120]]);
    expect(s19.mvp.map((p) => p.name)).toEqual(['A Player 1']);
    expect(h.allTime.mostRuns[0]).toMatchObject({ name: 'Only History Guy', value: 300 });
    expect(h.allTime.mostTitles).toEqual([{ name: 'Old Lions', value: 1 }]);

    // Category isolation
    const ladies = (await ctx.http.get('/api/history?category=ladies').expect(200)).body;
    expect(ladies).toMatchObject({ available: false, seasons: [] });
  });
});
