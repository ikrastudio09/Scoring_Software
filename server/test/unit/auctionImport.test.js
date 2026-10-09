import { describe, expect, it } from 'vitest';
import { roleOf, shortNameFor, validateAuctionImport } from '../../src/services/auctionImport.js';

// Shapes exactly as exported from the auction system's Player / Team collections.
const player = (playerID, playerName, extra = {}) => ({
  playerID, playerName, Age: 25, playerType: 'All Rounder', playerPhone: '9999999999',
  playerPhoto: { url: `https://img.example/${playerID}.jpg`, public_id: `p${playerID}` },
  playingStyle: ['Right Arm Batting', 'Left Arm Balling'], soldPoints: 450000, playerStatus: 'sold', playerPool: 2, ...extra,
});
const team = (teamID, teamName, members) => ({
  teamID, teamName, teamTotalPoints: 8000000,
  teamPlayers: members.map(([playerID, playerName, soldPoints = 450000]) => ({ playerID, playerName, soldPoints, playerPool: 2 })),
});
const codes = (r) => r.errors.map((e) => e.code);

describe('auction import validation', () => {
  it('accepts a valid export and maps every player to its team by playerID → teamID', () => {
    const r = validateAuctionImport({
      players: [player(1024, 'Rahul Patil'), player(1025, 'Amit Shah'), player(1030, 'Unsold Guy', { playerStatus: 'unsold', soldPoints: 0 })],
      teams: [team(7, 'SGM Strikers', [[1024, 'Rahul Patil']]), team(8, 'Blue Blazers', [[1025, 'Amit Shah']])],
    });
    expect(r.ok).toBe(true);
    expect(r.checks.every((c) => c.ok)).toBe(true);
    expect(r.checks[0].label).toBe('3 players found (2 sold, 1 unsold)');
    expect(r.data.teams).toEqual([{ teamID: 7, name: 'SGM Strikers', players: [1024] }, { teamID: 8, name: 'Blue Blazers', players: [1025] }]);
    expect(r.data.players.map((p) => [p.playerID, p.teamID, p.status])).toEqual([[1024, 7, 'sold'], [1025, 8, 'sold']]);
    expect(r.data.players[0]).toMatchObject({ photoUrl: 'https://img.example/1024.jpg', playingStyle: ['Right Arm Batting', 'Left Arm Balling'], soldPoints: 450000, playerPool: 2 });
    // private data never makes it into the snapshot
    expect(JSON.stringify(r.data)).not.toMatch(/9999999999|playerPhone|Age|public_id/);
    expect(r.info.map((i) => i.code)).toEqual(['PRIVATE_DATA_DROPPED', 'UNSOLD_SKIPPED']);
  });

  it('accepts flat spreadsheet rows (one row per team member) and text numbers', () => {
    const r = validateAuctionImport({
      players: [
        { playerID: '1', playerName: 'One', playerStatus: 'Sold', soldPoints: '1,20,000', playerPool: '1', playingStyle: 'Left Arm Batting; Right Arm Balling', 'playerPhoto.url': 'https://x/1.png' },
        { playerID: '2', playerName: 'Two', playerStatus: 'sold', soldPoints: '90000', playerPool: '3' },
      ],
      teams: [
        { teamID: '4', teamName: 'Lions', playerID: '1', playerName: 'One' },
        { teamID: '4', teamName: 'Lions', playerID: '2', playerName: 'Two' },
      ],
    });
    expect(r.ok).toBe(true);
    expect(r.data.teams).toEqual([{ teamID: 4, name: 'Lions', players: [1, 2] }]);
    expect(r.data.players[0]).toMatchObject({ soldPoints: 120000, playerPool: 1, playingStyle: ['Left Arm Batting', 'Right Arm Balling'], photoUrl: 'https://x/1.png' });
  });

  it('accepts a single player sheet carrying teamID / teamName columns', () => {
    const r = validateAuctionImport({
      players: [{ playerID: 5, playerName: 'Five', teamID: 2, teamName: 'Tigers', playerStatus: 'sold', soldPoints: 1000 }],
      teams: [],
    });
    expect(r.ok).toBe(true);
    expect(r.data.teams).toEqual([{ teamID: 2, name: 'Tigers', players: [5] }]);
  });

  const cases = [
    ['duplicate playerID', { players: [player(1, 'A'), player(1, 'B')], teams: [team(1, 'T', [[1, 'A']])] }, 'PLAYER_ID_DUPLICATE'],
    ['duplicate teamID', { players: [player(1, 'A'), player(2, 'B')], teams: [team(1, 'T', [[1, 'A']]), team(1, 'U', [[2, 'B']])] }, 'TEAM_ID_DUPLICATE'],
    ['missing playerID', { players: [{ ...player(1, 'A'), playerID: undefined }], teams: [team(1, 'T', [])] }, 'PLAYER_ID_MISSING'],
    ['missing teamID', { players: [player(1, 'A')], teams: [{ ...team(1, 'T', [[1, 'A']]), teamID: '' }] }, 'TEAM_ID_MISSING'],
    ['sold player without a team', { players: [player(1, 'A'), player(2, 'B')], teams: [team(1, 'T', [[1, 'A']])] }, 'SOLD_WITHOUT_TEAM'],
    ['team referencing a non-existent player', { players: [player(1, 'A')], teams: [team(1, 'T', [[1, 'A'], [1077, 'Ghost']])] }, 'TEAM_PLAYER_UNKNOWN'],
    ['duplicate player inside a team', { players: [player(1, 'A')], teams: [team(1, 'T', [[1, 'A'], [1, 'A']])] }, 'TEAM_PLAYER_DUPLICATE'],
    ['player in two teams', { players: [player(1, 'A')], teams: [team(1, 'T', [[1, 'A']]), team(2, 'U', [[1, 'A']])] }, 'PLAYER_MULTIPLE_TEAMS'],
    ['invalid player status', { players: [player(1, 'A', { playerStatus: 'retained' })], teams: [team(1, 'T', [[1, 'A']])] }, 'PLAYER_STATUS_INVALID'],
    ['invalid auction value', { players: [player(1, 'A', { soldPoints: -5 })], teams: [team(1, 'T', [[1, 'A']])] }, 'AUCTION_VALUE_INVALID'],
    ['non-numeric auction value', { players: [player(1, 'A', { soldPoints: 'lots' })], teams: [team(1, 'T', [[1, 'A']])] }, 'AUCTION_VALUE_INVALID'],
    ['unsold player listed in a team', { players: [player(1, 'A', { playerStatus: 'unsold' })], teams: [team(1, 'T', [[1, 'A']])] }, 'UNSOLD_IN_TEAM'],
    ['missing player name', { players: [player(1, '')], teams: [team(1, 'T', [[1, '']])] }, 'PLAYER_NAME_MISSING'],
    ['missing team name', { players: [player(1, 'A')], teams: [team(1, '', [[1, 'A']])] }, 'TEAM_NAME_MISSING'],
    ['duplicate team name', { players: [player(1, 'A'), player(2, 'B')], teams: [team(1, 'Lions', [[1, 'A']]), team(2, 'lions', [[2, 'B']])] }, 'TEAM_NAME_DUPLICATE'],
    ['non-integer playerID', { players: [player(1.5, 'A')], teams: [team(1, 'T', [])] }, 'PLAYER_ID_INVALID'],
    ['nothing to import', { players: [], teams: [] }, 'NO_PLAYERS'],
  ];
  it.each(cases)('rejects %s', (_name, input, code) => {
    const r = validateAuctionImport(input);
    expect(r.ok).toBe(false);
    expect(codes(r)).toContain(code);
    expect(r.errors.every((e) => e.message && e.ref)).toBe(true);
  });

  it('warns (without blocking) about name and value mismatches, and uses the team value', () => {
    const r = validateAuctionImport({
      players: [player(1, 'Rahul Patil', { soldPoints: 400000 })],
      teams: [team(1, 'T', [[1, 'R. Patil', 450000]])],
    });
    expect(r.ok).toBe(true);
    expect(r.warnings.map((w) => w.code)).toEqual(['PLAYER_NAME_MISMATCH', 'AUCTION_VALUE_MISMATCH']);
    expect(r.data.players[0]).toMatchObject({ name: 'Rahul Patil', soldPoints: 450000 });
  });

  it('maps auction player types to roles and builds unique short names', () => {
    expect(['Batsman', 'Bowler', 'All Rounder', 'Wicket Keeper', 'Wicketkeeper Batsman', ''].map(roleOf))
      .toEqual(['batter', 'bowler', 'allrounder', 'wicketkeeper', 'wicketkeeper', 'batter']);
    const taken = new Set(['SS']);
    expect(shortNameFor('SGM Strikers', taken)).toBe('SGM');
    expect(shortNameFor('Super Stars', taken)).toBe('SS2');
    expect(shortNameFor('Royals', taken)).toBe('ROY');
  });
});
