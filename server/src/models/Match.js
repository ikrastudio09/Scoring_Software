import mongoose from 'mongoose';
import { MATCH_STAGES, MATCH_STATUS } from '@cricket/shared';

const { ObjectId } = mongoose.Schema.Types;

// Setup fields are source of truth. `status`, `stateVersion`, `summary` and `result` (except
// the confirmation fields) are derived from the event log and rewritten after every command.
const matchSchema = new mongoose.Schema({
  number: { type: Number, required: true, unique: true },
  stage: { type: String, enum: MATCH_STAGES, default: 'league' },
  group: { type: String, trim: true },
  teamA: { type: ObjectId, ref: 'Team' },
  teamB: { type: ObjectId, ref: 'Team' },
  // Placeholders for knockouts before teams are known, e.g. "Winner SF1".
  teamALabel: String,
  teamBLabel: String,
  venue: String,
  scheduledAt: { type: Date, index: true },
  status: { type: String, enum: Object.values(MATCH_STATUS), default: MATCH_STATUS.SCHEDULED, index: true },
  statusNote: String,
  rules: {
    oversPerInnings: { type: Number, required: true },
    ballsPerOver: { type: Number, required: true },
    maxOversPerBowler: { type: Number, required: true },
    wideRuns: { type: Number, required: true },
    noBallRuns: { type: Number, required: true },
    freeHit: { type: Boolean, required: true },
  },
  toss: {
    winner: { type: ObjectId, ref: 'Team' },
    decision: { type: String, enum: ['bat', 'bowl'] },
  },
  playingXI: {
    teamA: [{ type: ObjectId, ref: 'Player' }],
    teamB: [{ type: ObjectId, ref: 'Player' }],
  },
  stateVersion: { type: Number, default: 0 },
  summary: { type: mongoose.Schema.Types.Mixed, default: null },
  result: {
    type: { type: String },
    winner: { type: ObjectId, ref: 'Team' },
    loser: { type: ObjectId, ref: 'Team' },
    marginRuns: Number,
    marginWickets: Number,
    ballsRemaining: Number,
    text: String,
    confirmed: { type: Boolean, default: false },
    confirmedAt: Date,
    confirmedBy: String,
    playerOfMatch: { type: ObjectId, ref: 'Player' },
  },
  startedAt: Date,
  completedAt: Date,
}, { timestamps: true });

matchSchema.index({ 'result.confirmed': 1, stage: 1 });

export const Match = mongoose.model('Match', matchSchema);
