import mongoose from 'mongoose';

// The permanent identity of a franchise across seasons (names change: "Team Challenger" →
// "Challengers"). Each season's Team record points here; linking is admin-assisted only.
const teamIdentitySchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  nameKey: { type: String, index: true },
  // Other names this franchise has used (e.g. spellings found in historical files).
  aliases: [{ type: String, trim: true }],
  mergedInto: { type: mongoose.Schema.Types.ObjectId, ref: 'TeamIdentity', default: null },
}, { timestamps: true });

export const TeamIdentity = mongoose.model('TeamIdentity', teamIdentitySchema);
