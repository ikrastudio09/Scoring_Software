// Request schemas. Strict objects: unknown keys are rejected.
import { z } from 'zod';
import { DELIVERY_DISMISSALS, MATCH_STAGES, MATCH_STATUS, PERFORMANCE_KEYS, ROLES, SHOT_TYPES, SUPPLIED_RATES } from '@cricket/shared';

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
const pointsSchema = z.strictObject({
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
}).partial();
const impactWeightsSchema = z.strictObject({
  batting: z.partialRecord(z.enum(['run', 'four', 'six', 'fifty', 'hundred', 'runsAbovePar', 'duck']), z.number().min(-100).max(100)).optional(),
  bowling: z.partialRecord(z.enum(['wicket', 'topOrderWicket', 'dot', 'maiden', 'threeWickets', 'runsSavedVsPar']), z.number().min(-100).max(100)).optional(),
  fielding: z.partialRecord(z.enum(['catch', 'runOut', 'stumping']), z.number().min(-100).max(100)).optional(),
  context: z.partialRecord(z.enum(['chaseWinPct', 'defendWinPct']), z.number().min(0).max(100)).optional(),
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
  points: pointsSchema.optional(),
  impactWeights: impactWeightsSchema.nullable().optional(),
});

// ── categories (Men's / Ladies / Kids): overrides of the season defaults; null = use the default ──
const categoryRef = z.string().trim().min(1).max(40);
export const categoryUpdateSchema = z.strictObject({
  name: text(40).min(1).optional(),
  shortName: text(20).optional(),
  order: z.number().int().min(0).max(99).optional(),
  active: z.boolean().optional(),
  rules: rulesSchema.extend({ playersPerSide: z.number().int().min(2).max(15) }).partial().nullable().optional(),
  points: pointsSchema.nullable().optional(),
  impactWeights: impactWeightsSchema.nullable().optional(),
  leaderboards: z.strictObject({
    strikeRateMinBalls: z.number().int().min(0).max(1000),
    economyMinBalls: z.number().int().min(0).max(1000),
    averageMinInnings: z.number().int().min(0).max(100),
    capMinMatches: z.number().int().min(0).max(100),
  }).partial().nullable().optional(),
  qualification: z.strictObject({ slots: z.number().int().min(1).max(16) }).partial().nullable().optional(),
});
export const categoryQuery = z.object({ category: categoryRef.optional() });

// ── teams / players ──
export const teamSchema = z.strictObject({
  category: categoryRef.optional(), // key (mens / ladies / kids) or id; default category when omitted
  name: text(80).min(1),
  shortName: z.string().trim().min(1).max(5),
  color: color.optional(),
  logoUrl: url.optional(),
  group: text(20).optional(),
  captain: objectId.nullable().optional(),
  homeGround: text(120).optional(),
  teamID: z.number().int().positive().nullable().optional(),
});
export const teamUpdateSchema = teamSchema.omit({ category: true }).partial();

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
  category: categoryRef.optional(),
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
export const matchUpdateSchema = matchCreateSchema.omit({ category: true }).extend({ statusNote: text(200).optional() });

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
  category: categoryRef.optional(),
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

// ── qualification what-if (hypothetical; never stored) ──
const hypoSide = z.strictObject({ runs: z.number().int().min(0).max(999), wickets: z.number().int().min(0).max(14), overs: z.union([z.string().max(5), z.number().min(0).max(99)]) });
export const whatIfSchema = z.strictObject({
  category: categoryRef.optional(),
  results: z.array(z.strictObject({
    matchId: objectId,
    outcome: z.enum(['A', 'B', 'T', 'N']),
    bonus: z.boolean().optional(),
    score: z.strictObject({ battedFirst: z.enum(['teamA', 'teamB']), teamA: hypoSide, teamB: hypoSide }).optional(),
  })).max(200),
});

// ── historical records import (rows are free-form; the service validates every value) ──
export const historyImportSchema = z.strictObject({
  kind: z.enum(['players', 'teams']),
  fileName: text(200).optional(),
  rows: z.array(z.record(z.string(), z.unknown())).max(10000),
  mapping: z.record(z.string(), z.string().max(200)),
  category: categoryRef.optional(),
  categoryValues: z.record(z.string(), z.enum(['mens', 'ladies', 'kids'])).optional(),
  seasonFromYear: z.strictObject({ year: z.number().int().min(1990).max(2100), season: z.number().int().min(1).max(200) }).optional(),
  choices: z.record(z.string(), z.string().max(40)).optional(), // group → 'new' | identity id
  overwrite: z.boolean().optional(),
  hash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
});

// ── historical aggregates (admin maintenance) ──
const count = z.number().int().min(0).max(100000).nullable().optional();
export const performanceInput = z.strictObject({
  ...Object.fromEntries(PERFORMANCE_KEYS.map((k) => [k, count])),
  supplied: z.strictObject(Object.fromEntries(SUPPLIED_RATES.map((r) => [r.key, z.number().min(0).max(1000).nullable().optional()]))).optional(),
  meta: z.strictObject({
    label: text(40).optional(), season: z.number().int().min(1).max(200).optional(),
    fromSeason: z.number().int().min(1).max(200).optional(), toSeason: z.number().int().min(1).max(200).optional(),
  }).optional(),
}).nullable();
export const historyUpdateSchema = z.strictObject({
  previousYear: performanceInput.optional(),
  overallPrevious: performanceInput.optional(),
  previousSeason: z.strictObject({ team: text(80).nullable().optional(), points: z.number().min(0).nullable().optional() }).nullable().optional(),
  reason: text(300).min(3),
});
export const identityLinkSchema = z.strictObject({ identityId: objectId.nullable() });

// ── auction import (rows are free-form; the import service validates every field) ──
export const auctionImportSchema = z.strictObject({
  category: categoryRef.optional(),
  // playerID → id of an existing record without playerID that the admin confirmed is the same person
  links: z.record(z.string().regex(/^\d+$/), objectId).optional(),
  players: z.array(z.record(z.string(), z.unknown())).max(5000),
  teams: z.array(z.record(z.string(), z.unknown())).max(5000),
  hash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
});
