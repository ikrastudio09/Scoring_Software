import mongoose from 'mongoose';

// Administrative actions (setup, status changes, confirmations, CRUD). Scoring commands are
// audited by MatchEvent itself.
const auditLogSchema = new mongoose.Schema({
  at: { type: Date, default: Date.now, index: true },
  user: { id: String, username: String },
  action: { type: String, required: true },
  entity: String,
  entityId: String,
  details: mongoose.Schema.Types.Mixed,
}, { versionKey: false });

auditLogSchema.index({ entity: 1, entityId: 1, at: -1 });

export const AuditLog = mongoose.model('AuditLog', auditLogSchema);
