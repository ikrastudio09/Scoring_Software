import mongoose from 'mongoose';

const teamSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, unique: true },
  shortName: { type: String, required: true, trim: true, uppercase: true, maxlength: 5 },
  color: { type: String, default: '#334155' },
  logoUrl: String,
  group: { type: String, trim: true },
  captain: { type: mongoose.Schema.Types.ObjectId, ref: 'Player' },
  homeGround: String,
}, { timestamps: true });

export const Team = mongoose.model('Team', teamSchema);
