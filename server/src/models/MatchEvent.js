import mongoose from 'mongoose';
import { EVENT_TYPES } from '@cricket/shared';

const { ObjectId } = mongoose.Schema.Types;

// THE source of truth for scoring. Append-only: documents are never deleted or rewritten,
// except that the `undone*` audit fields are set when an UNDO event reverts one.
// Which events are effective is decided by replaying UNDO events, not by the `undone` flag.
const matchEventSchema = new mongoose.Schema({
  match: { type: ObjectId, ref: 'Match', required: true },
  seq: { type: Number, required: true },
  type: { type: String, enum: Object.values(EVENT_TYPES), required: true },
  payload: { type: mongoose.Schema.Types.Mixed, default: {} },
  clientEventId: { type: String },
  // For UNDO events: the seq of the event that was reverted.
  undoesSeq: Number,
  // The situation before the event, for the audit trail.
  context: { type: mongoose.Schema.Types.Mixed },
  effects: [String],
  label: String,
  user: { id: String, username: String },
  undone: { type: Boolean, default: false },
  undoneAt: Date,
  undoneBy: String,
  undoneBySeq: Number,
  createdAt: { type: Date, default: Date.now },
}, { versionKey: false });

// Two events can never share a sequence number: this index is the commit guard.
matchEventSchema.index({ match: 1, seq: 1 }, { unique: true });
// A retried request (same clientEventId) can never create a second event.
matchEventSchema.index(
  { match: 1, clientEventId: 1 },
  { unique: true, partialFilterExpression: { clientEventId: { $type: 'string' } } },
);

export const MatchEvent = mongoose.model('MatchEvent', matchEventSchema);
