import mongoose from 'mongoose';

// Exactly one document (key = "main"). Rules are defaults copied into each match at creation,
// so editing them never changes a match that has already been set up.
const tournamentSchema = new mongoose.Schema({
  key: { type: String, default: 'main', unique: true },
  name: { type: String, required: true, trim: true },
  shortName: { type: String, trim: true },
  season: { type: String, trim: true },
  description: String,
  logoUrl: String,
  primaryColor: { type: String, default: '#0f766e' },
  accentColor: { type: String, default: '#f59e0b' },
  venues: [{ type: String, trim: true }],
  startDate: Date,
  endDate: Date,
  rules: {
    oversPerInnings: { type: Number, default: 10, min: 1, max: 50 },
    ballsPerOver: { type: Number, default: 6, min: 4, max: 8 },
    maxOversPerBowler: { type: Number, default: 2, min: 1, max: 50 },
    playersPerSide: { type: Number, default: 11, min: 2, max: 15 },
    wideRuns: { type: Number, default: 1, min: 0, max: 5 },
    noBallRuns: { type: Number, default: 1, min: 0, max: 5 },
    freeHit: { type: Boolean, default: true },
  },
  points: {
    win: { type: Number, default: 2 },
    loss: { type: Number, default: 0 },
    tie: { type: Number, default: 1 },
    noResult: { type: Number, default: 1 },
    // Which match stages count toward the table.
    stages: { type: [String], default: ['league'] },
    // NRR: a side bowled out is charged the full quota of overs (standard ICC rule).
    nrrAllOutUsesFullQuota: { type: Boolean, default: true },
  },
}, { timestamps: true });

export const Tournament = mongoose.model('Tournament', tournamentSchema);
