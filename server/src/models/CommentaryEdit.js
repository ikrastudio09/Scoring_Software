import mongoose from 'mongoose';

// Scorer edits of generated commentary, one per ball (match, seq). Kept apart from MatchEvent so
// the scoring log stays append-only and commentary can never influence the score.
const commentaryEditSchema = new mongoose.Schema({
  match: { type: mongoose.Schema.Types.ObjectId, ref: 'Match', required: true },
  seq: { type: Number, required: true },
  text: { type: String, required: true, maxlength: 500 },
  user: { id: String, username: String },
  at: { type: Date, default: Date.now },
}, { versionKey: false });

commentaryEditSchema.index({ match: 1, seq: 1 }, { unique: true });

export const CommentaryEdit = mongoose.model('CommentaryEdit', commentaryEditSchema);
