import mongoose from 'mongoose';
import { performanceSchema } from './performance.js';

const { ObjectId } = mongoose.Schema.Types;

// Historical MPL records imported from files (seasons before the ones scored in this system).
// Kept apart from everything scored ball by ball; the career rules that combine them without
// double counting live in services/history.js. Every row remembers the import it came from, so a
// whole import can be undone.

// One person's figures in one season of one category.
const historicalPlayerSeasonSchema = new mongoose.Schema({
  identity: { type: ObjectId, ref: 'PlayerIdentity', required: true, index: true },
  season: { type: Number, required: true },
  categoryKey: { type: String, required: true },
  name: { type: String, trim: true }, // as written in the source
  teamName: { type: String, trim: true },
  playerID: Number, // that season's auction id, if the file has it (informative only)
  performance: { type: performanceSchema, required: true },
  mvpAward: Boolean, // season MVP
  importId: { type: ObjectId, ref: 'HistoricalImport', required: true, index: true },
}, { timestamps: true });
historicalPlayerSeasonSchema.index({ identity: 1, season: 1, categoryKey: 1 }, { unique: true });
historicalPlayerSeasonSchema.index({ categoryKey: 1, season: 1 });

// One franchise's season in one category.
const historicalTeamSeasonSchema = new mongoose.Schema({
  teamIdentity: { type: ObjectId, ref: 'TeamIdentity', required: true, index: true },
  season: { type: Number, required: true },
  categoryKey: { type: String, required: true },
  name: { type: String, trim: true }, // the name used that season
  matches: Number,
  won: Number,
  lost: Number,
  tied: Number,
  noResult: Number,
  points: Number,
  nrr: Number,
  highestScore: Number,
  position: Number,
  champion: Boolean,
  finalist: Boolean, // reached the final (the champion is a finalist too)
  importId: { type: ObjectId, ref: 'HistoricalImport', required: true, index: true },
}, { timestamps: true });
historicalTeamSeasonSchema.index({ teamIdentity: 1, season: 1, categoryKey: 1 }, { unique: true });
historicalTeamSeasonSchema.index({ categoryKey: 1, season: 1 });

// One confirmed import (audit trail and undo).
const historicalImportSchema = new mongoose.Schema({
  kind: { type: String, enum: ['players', 'teams'], required: true },
  categoryKey: String, // null when the file maps several categories
  fileName: String,
  hash: String,
  summary: mongoose.Schema.Types.Mixed,
  // Rows this import replaced (only when the admin confirmed "replace"): restored by an undo.
  replaced: { type: [mongoose.Schema.Types.Mixed], default: [] },
  createdBy: String,
  undoneAt: Date,
  undoneBy: String,
}, { timestamps: true });

export const HistoricalPlayerSeason = mongoose.model('HistoricalPlayerSeason', historicalPlayerSeasonSchema);
export const HistoricalTeamSeason = mongoose.model('HistoricalTeamSeason', historicalTeamSeasonSchema);
export const HistoricalImport = mongoose.model('HistoricalImport', historicalImportSchema);
