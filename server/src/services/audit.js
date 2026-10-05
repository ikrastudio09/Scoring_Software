import { AuditLog } from '../models/index.js';
import { logger } from '../utils/logger.js';

/** Record an administrative action. Never throws: auditing must not block the action. */
export async function audit(user, action, entity, entityId, details) {
  const entry = {
    user: user ? { id: String(user.id), username: user.username } : { username: 'system' },
    action, entity, entityId: entityId ? String(entityId) : undefined, details,
  };
  logger.info({ audit: entry }, `audit: ${action}`);
  try {
    await AuditLog.create(entry);
  } catch (err) {
    logger.error({ err, action }, 'failed to write audit log');
  }
}
