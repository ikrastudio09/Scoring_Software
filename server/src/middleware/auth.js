import { ROLES } from '@cricket/shared';
import { verifyToken } from '../services/auth.js';
import { forbidden, unauthorized } from '../utils/errors.js';

export function bearer(req) {
  const h = req.headers.authorization || '';
  return h.startsWith('Bearer ') ? h.slice(7) : null;
}

/** Requires a valid token; optionally restricts to roles. Admins can do everything. */
export function requireAuth(...roles) {
  return (req, _res, next) => {
    const user = verifyToken(bearer(req));
    if (!user) return next(unauthorized());
    if (roles.length && user.role !== ROLES.ADMIN && !roles.includes(user.role)) return next(forbidden());
    req.user = user;
    return next();
  };
}

export const requireAdmin = requireAuth(ROLES.ADMIN);
export const requireScorer = requireAuth(ROLES.SCORER, ROLES.ADMIN);
