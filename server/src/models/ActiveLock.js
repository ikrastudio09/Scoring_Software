import mongoose from 'mongoose';

// The global one-active-match lock: a single document (_id "global") across ALL categories.
// A match claims it atomically when it enters play (services/active.js claimActiveLock); the
// conditional update ({ matchId: null } or already ours) + the unique _id make a second claim
// impossible even across processes. Released when the result is confirmed (or the match leaves
// play through an undo). Repaired from the match documents at startup.
const activeLockSchema = new mongoose.Schema({
  _id: { type: String },
  matchId: { type: mongoose.Schema.Types.ObjectId, ref: 'Match', default: null },
  category: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', default: null },
  number: Number,
  claimedAt: Date,
  claimedBy: String,
  releasedAt: Date,
}, { versionKey: false });

export const ActiveLock = mongoose.model('ActiveLock', activeLockSchema);
