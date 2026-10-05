import mongoose from 'mongoose';
import { ROLES } from '@cricket/shared';

const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true, lowercase: true, trim: true },
  name: { type: String, trim: true },
  passwordHash: { type: String, required: true, select: false },
  role: { type: String, enum: Object.values(ROLES), default: ROLES.SCORER },
  active: { type: Boolean, default: true },
  lastLoginAt: Date,
}, { timestamps: true });

export const User = mongoose.model('User', userSchema);
