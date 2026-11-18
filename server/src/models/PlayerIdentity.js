import mongoose from 'mongoose';

// The permanent identity of a person across seasons and categories. The auction playerID changes
// every season and is unique only inside one category, so it cannot identify a person; season
// player records (models/Player.js) point here instead. Identities are linked only by an admin
// (services/identities.js) — never automatically by name or phone.
const playerIdentitySchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  // Normalised name, for SUGGESTIONS only.
  nameKey: { type: String, index: true },
  notes: { type: String, trim: true, maxlength: 500 },
  // Set when an admin merged this identity into another; kept for the audit trail, never deleted.
  mergedInto: { type: mongoose.Schema.Types.ObjectId, ref: 'PlayerIdentity', default: null },
}, { timestamps: true });

export const PlayerIdentity = mongoose.model('PlayerIdentity', playerIdentitySchema);
