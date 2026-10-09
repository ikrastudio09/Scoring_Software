import mongoose from 'mongoose';

const teamSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, unique: true },
  shortName: { type: String, required: true, trim: true, uppercase: true, maxlength: 5 },
  color: { type: String, default: '#334155' },
  logoUrl: String,
  group: { type: String, trim: true },
  captain: { type: mongoose.Schema.Types.ObjectId, ref: 'Player' },
  homeGround: String,
  // Canonical team identifier from the auction system (playerID → teamID is the mapping key).
  teamID: { type: Number },
}, { timestamps: true });

teamSchema.index({ teamID: 1 }, { unique: true, partialFilterExpression: { teamID: { $type: 'number' } } });

export const Team = mongoose.model('Team', teamSchema);
