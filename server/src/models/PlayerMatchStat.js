import mongoose from 'mongoose';

const { ObjectId } = mongoose.Schema.Types;

// DERIVED from match events when a result is confirmed. Safe to delete and rebuild.
const playerMatchStatSchema = new mongoose.Schema({
  match: { type: ObjectId, ref: 'Match', required: true },
  player: { type: ObjectId, ref: 'Player', required: true },
  team: { type: ObjectId, ref: 'Team', required: true },
  opponent: { type: ObjectId, ref: 'Team' },
  stage: String,
  matchNumber: Number,
  matchDate: Date,
  batting: { type: mongoose.Schema.Types.Mixed, default: null },
  bowling: { type: mongoose.Schema.Types.Mixed, default: null },
  fielding: { catches: Number, runOuts: Number, stumpings: Number },
  playerOfMatch: { type: Boolean, default: false },
  ballsPerOver: { type: Number, default: 6 },
}, { versionKey: false });

playerMatchStatSchema.index({ match: 1, player: 1 }, { unique: true });
playerMatchStatSchema.index({ player: 1 });

export const PlayerMatchStat = mongoose.model('PlayerMatchStat', playerMatchStatSchema);
