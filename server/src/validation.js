// Request schemas. Strict objects: unknown keys are rejected.
import { z } from 'zod';
import { DELIVERY_DISMISSALS, MATCH_STAGES, MATCH_STATUS, ROLES, SHOT_TYPES } from '@cricket/shared';

export const objectId = z.string().regex(/^[a-f0-9]{24}$/i, 'must be a valid id');
const color = z.string().regex(/^#[0-9a-f]{6}$/i, 'must be a #rrggbb colour');
const url = z.string().max(2000).refine((v) => v === '' || /^(https?:\/\/|\/)/.test(v), 'must be an http(s) URL or a /path');
const text = (max = 120) => z.string().trim().max(max);

// ── auth / users ──
export const loginSchema = z.strictObject({ username: text(60).min(1), password: z.string().min(1).max(200) });
export const createUserSchema = z.strictObject({
  username: z.string().trim().min(3).max(40).regex(/^[a-z0-9._-]+$/i, 'letters, digits, . _ - only'),
  password: z.string().min(10, 'at least 10 characters').max(200),
  name: text(80).optional(),
  role: z.enum(Object.values(ROLES)).optional(),
});

// ── tournament ──
const rulesSchema = z.strictObject({
  oversPerInnings: z.number().int().min(1).max(50),
  ballsPerOver: z.number().int().min(4).max(8),
  maxOversPerBowler: z.number().int().min(1).max(50),
  wideRuns: z.number().int().min(0).max(5),
  noBallRuns: z.number().int().min(0).max(5),
  freeHit: z.boolean(),
});
export const tournamentSchema = z.strictObject({
  name: text(120).min(1).optional(),
  shortName: text(20).optional(),
  season: text(40).optional(),
  description: text(2000).optional(),
  logoUrl: url.optional(),
  primaryColor: color.optional(),
  accentColor: color.optional(),
  venues: z.array(text(120).min(1)).max(50).optional(),
  startDate: z.coerce.date().nullable().optional(),
  endDate: z.coerce.date().nullable().optional(),
  rules: rulesSchema.extend({ playersPerSide: z.number().int().min(2).max(15) }).partial().optional(),
  points: z.strictObject({
    win: z.number().min(0).max(10),
    loss: z.number().min(-5).max(10),
    tie: z.number().min(0).max(10),
    noResult: z.number().min(0).max(10),
    stages: z.array(z.enum(MATCH_STAGES)).min(1),
    nrrAllOutUsesFullQuota: z.boolean(),
    tiebreakers: z.array(z.enum(['nrr', 'wins', 'headToHead'])).max(3),
    bonus: z.strictObject({
      enabled: z.boolean(),
      points: z.number().min(0).max(5),
      runsPercent: z.number().min(1).max(100),
      oversPercent: z.number().min(1).max(100),
    }).partial(),
  }).partial().optional(),
  impactWeights: z.strictObject({
    batting: z.partialRecord(z.enum(['run', 'four', 'six', 'fifty', 'hundred', 'runsAbovePar', 'duck']), z.number().min(-100).max(100)).optional(),
    bowling: z.partialRecord(z.enum(['wicket', 'topOrderWicket', 'dot', 'maiden', 'threeWickets', 'runsSavedVsPar']), z.number().min(-100).max(100)).optional(),
    fielding: z.partialRecord(z.enum(['catch', 'runOut', 'stumping']), z.number().min(-100).max(100)).optional(),
    context: z.partialRecord(z.enum(['chaseWinPct', 'defendWinPct']), z.number().min(0).max(100)).optional(),
  }).nullable().optional(),
});

// ── teams / players ──
export const teamSchema = z.strictObject({
  name: text(80).min(1),
  shortName: z.string().trim().min(1).max(5),
  color: color.optional(),
  logoUrl: url.optional(),
  group: text(20).optional(),
  captain: objectId.nullable().optional(),
  homeGround: text(120).optional(),
  teamID: z.number().int().positive().nullable().optional(),
});
export const teamUpdateSchema = teamSchema.partial();

export const playerSchema = z.strictObject({
  name: text(80).min(1),
  team: objectId,
  role: z.enum(['batter', 'bowler', 'allrounder', 'wicketkeeper']).optional(),
  battingStyle: z.enum(['right', 'left']).optional(),
  bowlingStyle: text(60).optional(),
  jerseyNumber: z.number().int().min(0).max(999).nullable().optional(),
  photoUrl: url.optional(),
  active: z.boolean().optional(),
  playerID: z.number().int().positive().nullable().optional(),
  playerType: text(40).optional(),
  playingStyle: z.array(z.enum(['Right Arm Batting', 'Right Arm Balling', 'Left Arm Batting', 'Left Arm Balling'])).max(2).optional(),
});
export const playerUpdateSchema = playerSchema.partial();

// ── matches ──
export const matchCreateSchema = z.strictObject({
  number: z.number().int().min(1).optional(),
  stage: z.enum(MATCH_STAGES).optional(),
  group: text(20).optional(),
  teamA: objectId.nullable().optional(),
  teamB: objectId.nullable().optional(),
  teamALabel: text(40).optional(),
  teamBLabel: text(40).optional(),
  venue: text(120).optional(),
  scheduledAt: z.coerce.date().optional(),
  rules: rulesSchema.partial().optional(),
});
export const matchUpdateSchema = matchCreateSchema.extend({ statusNote: text(200).optional() });

export const matchSetupSchema = z.strictObject({
  toss: z.strictObject({ winner: objectId, decision: z.enum(['bat', 'bowl']) }),
  playingXI: z.strictObject({ teamA: z.array(objectId).min(2).max(15), teamB: z.array(objectId).min(2).max(15) }),
});
export const matchStatusSchema = z.strictObject({
  status: z.enum([MATCH_STATUS.SCHEDULED, MATCH_STATUS.POSTPONED, MATCH_STATUS.CANCELLED, MATCH_STATUS.ABANDONED]),
  note: text(200).optional(),
});
export const confirmSchema = z.strictObject({ playerOfMatch: objectId.nullable().optional() });
export const reopenSchema = z.strictObject({ reason: text(300).min(3) });
export const matchListQuery = z.object({
  status: z.string().max(200).optional(),
  stage: z.enum(MATCH_STAGES).optional(),
  team: objectId.optional(),
});

// ── scoring commands ──
// Every command carries an idempotency key and the version the scorer was looking at.
const command = {
  clientEventId: z.string().min(8).max(80).regex(/^[A-Za-z0-9_-]+$/),
  expectedVersion: z.number().int().min(0),
};
export const startInningsSchema = z.strictObject({ ...command, strikerId: objectId, nonStrikerId: objectId, bowlerId: objectId });
export const deliverySchema = z.strictObject({
  ...command,
  extra: z.enum(['wide', 'noball', 'bye', 'legbye']).nullable().optional(),
  runs: z.number().int().min(0).max(7),
  boundary: z.boolean().optional(),
  noBallRunsType: z.enum(['bat', 'bye', 'legbye']).optional(),
  shot: z.enum(Object.keys(SHOT_TYPES)).optional(),
  wicket: z.strictObject({
    type: z.enum(DELIVERY_DISMISSALS),
    batterId: objectId.optional(),
    fielderId: objectId.optional(),
    substituteFielder: z.boolean().optional(),
  }).optional(),
});
export const setBowlerSchema = z.strictObject({ ...command, bowlerId: objectId, midOver: z.boolean().optional() });
export const newBatterSchema = z.strictObject({ ...command, batterId: objectId, end: z.enum(['striker', 'nonStriker']).optional() });
export const retireSchema = z.strictObject({ ...command, batterId: objectId, kind: z.enum(['retired_hurt', 'retired_out']) });
export const plainCommandSchema = z.strictObject({ ...command });
export const endInningsSchema = z.strictObject({ ...command, reason: text(40).optional() });
export const concludeSchema = z.strictObject({
  ...command,
  resultType: z.enum(['no_result', 'abandoned', 'walkover']),
  winnerTeamId: objectId.optional(),
});

// ── commentary ──
export const commentaryQuery = z.object({
  limit: z.coerce.number().int().min(1).max(300).optional(),
  before: z.coerce.number().int().min(1).optional(),
});
export const commentaryEditSchema = z.strictObject({ text: z.string().max(500) });

// ── auction import (rows are free-form; the import service validates every field) ──
export const auctionImportSchema = z.strictObject({
  players: z.array(z.record(z.string(), z.unknown())).max(5000),
  teams: z.array(z.record(z.string(), z.unknown())).max(5000),
  hash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
});
