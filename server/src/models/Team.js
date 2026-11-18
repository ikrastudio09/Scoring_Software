import mongoose from 'mongoose';

const teamSchema = new mongoose.Schema({
  // Men's / Ladies / Kids of one season. Names and teamIDs are unique within a category only.
  category: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', index: true },
  // The permanent franchise behind this season's team (models/TeamIdentity.js).
  identity: { type: mongoose.Schema.Types.ObjectId, ref: 'TeamIdentity', index: true },
  name: { type: String, required: true, trim: true },
  shortName: { type: String, required: true, trim: true, uppercase: true, maxlength: 5 },
  color: { type: String, default: '#334155' },
  logoUrl: String,
  group: { type: String, trim: true },
  captain: { type: mongoose.Schema.Types.ObjectId, ref: 'Player' },
  homeGround: String,
  // Canonical team identifier from the auction system (playerID → teamID is the mapping key).
  teamID: { type: Number },
}, { timestamps: true });

teamSchema.index({ category: 1, name: 1 }, { unique: true });
teamSchema.index({ category: 1, teamID: 1 }, { unique: true, partialFilterExpression: { teamID: { $type: 'number' } } });

export const Team = mongoose.model('Team', teamSchema);
