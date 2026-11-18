// Phase 3: auction snapshot v2 (Age private, previous team, the two historical aggregates),
// admin maintenance of history, and permanent player / team identities — through the HTTP API.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Player, PlayerIdentity, Team, TeamIdentity } from '../../src/models/index.js';
import { auth, bootServer } from './harness.js';

let ctx;
beforeAll(async () => { ctx = await bootServer(); });
afterAll(async () => { await ctx?.close(); });

const admin = () => auth(ctx.adminToken);

// Rows in the shape of the MPL-2025 player list (Previous Statistics as text).
const pdfRow = (playerID, playerName, Age, previousTeam, previousTeamPoints, stats) => ({
  playerID, playerName, Age, playerPhone: '9000000000', previousTeam, previousTeamPoints,
  previousPerformance: stats, playerType: 'All Rounder', playerStatus: 'sold', soldPoints: 1000, playerPool: 1,
});
const MENS = {
  category: 'mens',
  players: [
    pdfRow(1, 'KISHAN CHANDRASHEKHAR BAJAJ', 30, 'SSK WARRIORS', 3000, 'ASD:- S-10, M-63, R-380, W-57, C-18, MOM-10 | 2024:- M-10, R-41, W-4, C-3'),
    pdfRow(3, 'DHAWAL MANISH MALU', 25, 'NULL', 'NULL', 'ASD:- S-5, M-11, R-0, W-6, C-2'),
    pdfRow(13, 'VEDANT DEEPAK KABARA', 18, 'N/A', 0, 'N/A'),
    pdfRow(34, 'SAMARTH MAHESH BALDAWA', 17, 'KANKANI SUPER GIANTS', 1500, 'ASD:- S-1, M-7, R-26, W-7, C-2, MOM-7 | 2024:- M-7, R-26, W-7, C-2, MOM-1'),
    pdfRow(135, 'AJAY PAPALAL SARDA', 1, 'NULL', 'NULL', 'ASD:- S-9, M-32, R-91, W-15, C-10'),
  ],
  teams: [
    { teamID: 1, teamName: 'Royal Strikers', teamPlayers: [{ playerID: 1 }, { playerID: 3 }, { playerID: 13 }] },
    { teamID: 2, teamName: 'Spartans', teamPlayers: [{ playerID: 34 }, { playerID: 135 }] },
  ],
};
const preview = async (body) => (await ctx.http.post('/api/admin/import/auction/preview').set(admin()).send(body).expect(200)).body;
const commit = async (body) => {
  const p = await preview(body);
  expect(p.ok).toBe(true);
  return (await ctx.http.post('/api/admin/import/auction/commit').set(admin()).send({ ...body, hash: p.hash }).expect(200)).body;
};
const byPid = (pid) => Player.findOne({ playerID: pid }).lean();

describe('auction snapshot with history', () => {
  it('previews history per player and summarises the problems', async () => {
    const p = await preview(MENS);
    const codes = (list) => list.map((x) => x.code);
    expect(codes(p.info)).toEqual(expect.arrayContaining(['PRIVATE_DATA_DROPPED', 'AGE_PRIVATE', 'HISTORY_IMPORTED']));
    expect(codes(p.warnings)).toEqual(expect.arrayContaining(['AGE_INVALID', 'HISTORY_MOM_UNRELIABLE']));
    // Labelled 2024 (the MPL-2025 list) but the season before this one is last calendar year.
    const year = new Date().getFullYear() - 1;
    if (year !== 2024) expect(codes(p.warnings)).toContain('HISTORY_YEAR_MISMATCH');
    const kishan = p.teams[0].players.find((x) => x.playerID === 1);
    expect(kishan.history.previousYear).toEqual({ seasons: 1, matches: 10, runs: 41, wickets: 4, catches: 3 });
    expect(kishan.history.overallPrevious).toEqual({ seasons: 9, matches: 53, runs: 339, wickets: 53, catches: 15 });
    expect(kishan.previousTeam).toBe('SSK WARRIORS');
    expect(JSON.stringify(p)).not.toMatch(/9000000000/);
  });

  it('stores both aggregates separately with the seasons they cover; age stays private', async () => {
    await commit(MENS);
    const kishan = await byPid(1);
    expect(kishan.age).toBe(30);
    expect(kishan.previousSeason).toEqual({ team: 'SSK WARRIORS', points: 3000 });
    expect(kishan.history.previousYear).toMatchObject({ matches: 10, runs: 41, meta: { label: '2024', season: 20 } });
    expect(kishan.history.overallPrevious).toMatchObject({ matches: 53, runs: 339, meta: { toSeason: 19 } });
    expect(kishan.history.overallPrevious.playerOfMatch).toBeUndefined(); // broken ASD MOM not imported
    expect(kishan.history.flags.map((f) => f.code)).toEqual(['HISTORY_MOM_UNRELIABLE']);
    expect(kishan.history.raw).toMatch(/^ASD:-/);

    const dhawal = await byPid(3);
    expect(dhawal.history.previousYear).toBeNull();
    expect(dhawal.previousSeason).toBeUndefined();
    expect((await byPid(13)).history.overallPrevious).toBeNull();
    expect((await byPid(34)).history.overallPrevious).toBeNull(); // only played last season
    expect((await byPid(135)).age).toBeUndefined(); // "Age 1" was not imported

    // public APIs never show age or phone
    const list = (await ctx.http.get('/api/players?category=mens').expect(200)).body;
    const one = (await ctx.http.get(`/api/players/${kishan._id}`).expect(200)).body;
    for (const body of [list, one]) expect(JSON.stringify(body)).not.toMatch(/"age"|9000000000|phone/i);
    // admins see age
    const adm = (await ctx.http.get('/api/admin/players?category=mens').set(admin()).expect(200)).body.players;
    expect(adm.find((x) => x.playerID === 1).age).toBe(30);
    await ctx.http.get('/api/admin/players').set(auth(ctx.scorerToken)).expect(403);

    // every imported record has its own new identity
    expect(await PlayerIdentity.countDocuments({ _id: { $in: (await Player.find({ playerID: { $in: [1, 3, 13, 34, 135] } }).lean()).map((x) => x.identity) } })).toBe(5);
    expect((await Team.findOne({ name: 'Royal Strikers' }).lean()).identity).toBeTruthy();
  });

  it('re-importing the same file changes nothing', async () => {
    const p = await preview(MENS);
    expect(p.counts.players).toEqual({ unchanged: 5 });
  });

  it('an admin correction is kept by later re-imports', async () => {
    const dhawal = await byPid(3);
    const res = await ctx.http.put(`/api/admin/players/${dhawal._id}/history`).set(admin())
      .send({ previousYear: { seasons: 1, matches: 2, runs: 12 }, reason: 'scorebook check' }).expect(200);
    expect(res.body.player.history).toMatchObject({ source: 'manual', previousYear: { seasons: 1, matches: 2, runs: 12 } });
    await ctx.http.put(`/api/admin/players/${dhawal._id}/history`).set(admin()).send({ previousYear: { runs: -4 }, reason: 'bad' }).expect(400);
    await ctx.http.put(`/api/admin/players/${dhawal._id}/history`).set(admin()).send({ previousYear: { runs: 4 } }).expect(400); // reason required

    const p = await preview(MENS);
    expect(p.warnings.map((w) => w.code)).toContain('HISTORY_MANUAL_KEPT');
    await commit(MENS);
    expect((await byPid(3)).history.previousYear).toMatchObject({ matches: 2, runs: 12 });
  });

  it('accepts structured aggregates and flags invalid fields', async () => {
    const body = {
      category: 'kids',
      players: [{
        playerID: 1, playerName: 'Kid One', playerStatus: 'sold',
        previousYearPerformance: { matches: 4, runs: 50, balls: 40, overs: '3.2', sr: 125, extra: 1 },
        overallPreviousPerformance: null,
      }],
      teams: [{ teamID: 1, teamName: 'Junior Lions', teamPlayers: [{ playerID: 1 }] }],
    };
    const p = await preview(body);
    expect(p.warnings.map((w) => w.code)).toContain('HISTORY_FIELD_INVALID');
    await commit(body);
    // playerID 1 exists in Men's AND Kids: ids are unique per category only
    const kid = await Player.findOne({ name: 'Kid One' }).lean();
    expect(kid.history.previousYear).toMatchObject({ matches: 4, runs: 50, ballsFaced: 40, ballsBowled: 20, supplied: { strikeRate: 125 } });
    expect(kid.history.overallPrevious).toBeNull();
  });
});

describe('player identities', () => {
  it('suggests, links and splits identities only on admin action', async () => {
    // The same person also appears in the Kids category (e.g. a junior record), with another playerID.
    await commit({
      category: 'kids',
      players: [{ playerID: 7, playerName: 'Samarth Mahesh  Baldawa', playerStatus: 'sold' }, { playerID: 1, playerName: 'Kid One', playerStatus: 'sold' }],
      teams: [{ teamID: 1, teamName: 'Junior Lions', teamPlayers: [{ playerID: 1 }, { playerID: 7 }] }],
    });
    const junior = await Player.findOne({ name: 'Samarth Mahesh  Baldawa' }).lean();
    const senior = await byPid(34);
    expect(String(junior.identity)).not.toBe(String(senior.identity)); // never merged automatically

    const review = (await ctx.http.get('/api/admin/identities/players?category=kids').set(admin()).expect(200)).body.players;
    const row = review.find((r) => r.id === String(junior._id));
    expect(row.suggestions).toHaveLength(1);
    expect(row.suggestions[0]).toMatchObject({ id: String(senior.identity), reason: expect.stringMatching(/Similar name/) });
    expect(row.suggestions[0].records[0]).toMatchObject({ playerID: 34, category: { key: 'mens' } });

    // link
    const linked = (await ctx.http.post(`/api/admin/players/${junior._id}/identity`).set(admin()).send({ identityId: String(senior.identity) }).expect(200)).body.identity;
    expect(linked.records.map((r) => r.category.key).sort()).toEqual(['kids', 'mens']);
    expect((await PlayerIdentity.findById(junior.identity).lean()).mergedInto.toString()).toBe(String(senior.identity));

    // one person cannot have two records in the same category
    const other = await byPid(135);
    await ctx.http.post(`/api/admin/players/${other._id}/identity`).set(admin()).send({ identityId: String(senior.identity) }).expect(409);

    // split again (undo the link)
    const split = (await ctx.http.post(`/api/admin/players/${junior._id}/identity`).set(admin()).send({ identityId: null }).expect(200)).body.identity;
    expect(split.records).toHaveLength(1);
    expect(split.id).not.toBe(String(senior.identity));
    // the merged identity id still resolves (to the live one) for old references
    const old = (await ctx.http.get(`/api/admin/identities/players/${junior.identity}`).set(admin()).expect(200)).body.identity;
    expect(old.id).toBe(String(senior.identity));
    await ctx.http.post(`/api/admin/players/${junior._id}/identity`).set(auth(ctx.scorerToken)).send({ identityId: null }).expect(403);
  });

  it('team identities: link a renamed franchise and keep the old name as an alias', async () => {
    const mensTeam = await Team.findOne({ name: 'Royal Strikers' }).lean();
    const kidsTeam = await Team.findOne({ name: 'Junior Lions' }).lean();
    const out = (await ctx.http.post(`/api/admin/teams/${kidsTeam._id}/identity`).set(admin()).send({ identityId: String(mensTeam.identity) }).expect(200)).body.identity;
    expect(out.records).toHaveLength(2);
    expect((await TeamIdentity.findById(mensTeam.identity).lean()).aliases).toContain('Junior Lions');
    const review = (await ctx.http.get('/api/admin/identities/teams?category=mens').set(admin()).expect(200)).body.teams;
    expect(review.find((t) => t.id === String(mensTeam._id)).identity.records).toHaveLength(2);
  });
});
