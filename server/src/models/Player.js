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
}, { timestamps: true });

export const Player = mongoose.model('Player', playerSchema);
