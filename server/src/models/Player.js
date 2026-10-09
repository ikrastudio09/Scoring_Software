import mongoose from 'mongoose';

const playerSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  team: { type: mongoose.Schema.Types.ObjectId, ref: 'Team', required: true, index: true },
  role: { type: String, enum: ['batter', 'bowler', 'allrounder', 'wicketkeeper'], default: 'batter' },
  battingStyle: { type: String, enum: ['right', 'left'], default: 'right' },
  bowlingStyle: { type: String, trim: true },
  jerseyNumber: Number,
  photoUrl: String,
  active: { type: Boolean, default: true },

  // ── tournament snapshot imported from the auction/registration system ──
  // playerID is the canonical player identifier across both systems (never the name).
  playerID: { type: Number },
  playerType: { type: String, trim: true }, // as registered, e.g. "All Rounder"
  playingStyle: [{ type: String, trim: true }], // e.g. ["Right Arm Batting", "Left Arm Balling"]
  auction: {
    soldPoints: Number,
    playerPool: Number,
    status: { type: String, enum: ['sold', 'unsold'] },
    importedAt: Date,
  },
  // Deliberately NOT stored: playerPhone, Age and other private registration data.
}, { timestamps: true });

playerSchema.index({ playerID: 1 }, { unique: true, partialFilterExpression: { playerID: { $type: 'number' } } });

export const Player = mongoose.model('Player', playerSchema);
