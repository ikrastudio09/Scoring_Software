import mongoose from 'mongoose';
import { performanceSchema } from './performance.js';

const playerSchema = new mongoose.Schema({
  // Same category as the team. playerID is unique per category of one season only (the auction
  // reuses ids across categories and seasons), so it is never a cross-season identity.
  category: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', index: true },
  // The permanent person behind this season's record (models/PlayerIdentity.js).
  identity: { type: mongoose.Schema.Types.ObjectId, ref: 'PlayerIdentity', index: true },
  name: { type: String, required: true, trim: true },
  team: { type: mongoose.Schema.Types.ObjectId, ref: 'Team', required: true, index: true },
  role: { type: String, enum: ['batter', 'bowler', 'allrounder', 'wicketkeeper'], default: 'batter' },
  battingStyle: { type: String, enum: ['right', 'left'], default: 'right' },
  bowlingStyle: { type: String, trim: true },
  jerseyNumber: Number,
  photoUrl: String,
  active: { type: Boolean, default: true },

  // ── tournament snapshot imported from the auction/registration system ──
  // playerID links this record to the auction system within one category and season (never the name).
  playerID: { type: Number },
  playerType: { type: String, trim: true }, // as registered, e.g. "All Rounder"
  playingStyle: [{ type: String, trim: true }], // e.g. ["Right Arm Batting", "Left Arm Balling"]
  auction: {
    soldPoints: Number,
    playerPool: Number,
    status: { type: String, enum: ['sold', 'unsold'] },
    importedAt: Date,
  },
  // PRIVATE: never returned by public APIs (routes/catalog.js uses an explicit allow-list).
  age: { type: Number, min: 1, max: 120 },
  // Auction snapshot of the previous season, as supplied.
  previousSeason: {
    team: { type: String, trim: true },
    points: Number,
  },
  // The two historical aggregates from the auction snapshot. Kept apart from each other and from
  // the current season, which is always calculated from this season's scored matches.
  history: {
    previousYear: { type: performanceSchema, default: null }, // the immediately preceding season
    overallPrevious: { type: performanceSchema, default: null }, // every season before that
    raw: String, // the source text, for the audit trail
    flags: [{ _id: false, code: String, message: String }],
    source: { type: String, enum: ['auction', 'manual', 'historical'] },
    updatedAt: Date,
    updatedBy: String,
  },
  // Deliberately NOT stored: playerPhone.
}, { timestamps: true });

playerSchema.index({ category: 1, playerID: 1 }, { unique: true, partialFilterExpression: { playerID: { $type: 'number' } } });

export const Player = mongoose.model('Player', playerSchema);
