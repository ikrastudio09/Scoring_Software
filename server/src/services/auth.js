import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { ROLES } from '@cricket/shared';
import { User } from '../models/index.js';
import { config } from '../config/env.js';
import { unauthorized, conflict } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

const BCRYPT_ROUNDS = 12;
// Constant-time-ish response for unknown users (avoids username probing by timing).
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 4);

export const hashPassword = (pw) => bcrypt.hash(pw, BCRYPT_ROUNDS);

export function signToken(user) {
  return jwt.sign(
    { sub: String(user._id), username: user.username, role: user.role },
    config.jwtSecret,
    { expiresIn: config.jwtExpiresIn, issuer: 'cricket-scoring' },
  );
}

/** Returns {id, username, role} or null. */
export function verifyToken(token) {
  if (!token) return null;
  try {
    const p = jwt.verify(token, config.jwtSecret, { issuer: 'cricket-scoring' });
    return { id: p.sub, username: p.username, role: p.role };
  } catch {
    return null;
  }
}

export async function login(username, password) {
  const user = await User.findOne({ username: String(username).toLowerCase(), active: true }).select('+passwordHash');
  const ok = await bcrypt.compare(password, user?.passwordHash || DUMMY_HASH);
  if (!user || !ok) throw unauthorized('Invalid username or password');
  user.lastLoginAt = new Date();
  await user.save();
  return { token: signToken(user), user: publicUser(user) };
}

export const publicUser = (u) => ({ id: String(u._id), username: u.username, name: u.name, role: u.role });

export async function createUser({ username, password, name, role = ROLES.SCORER }) {
  if (await User.exists({ username: username.toLowerCase() })) throw conflict('Username already exists');
  const user = await User.create({ username, name, role, passwordHash: await hashPassword(password) });
  return publicUser(user);
}

/** On first boot, create the admin from ADMIN_USERNAME / ADMIN_PASSWORD if there are no users. */
export async function ensureBootstrapAdmin() {
  if (await User.exists({})) return;
  const { username, password } = config.bootstrapAdmin;
  if (!username || !password) {
    logger.warn('No users exist. Set ADMIN_USERNAME and ADMIN_PASSWORD (or run `npm run create-user`).');
    return;
  }
  await createUser({ username, password, name: 'Administrator', role: ROLES.ADMIN });
  logger.info({ username }, 'bootstrap admin user created');
}
