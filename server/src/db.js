import mongoose from 'mongoose';
import { config } from './config/env.js';
import { logger } from './utils/logger.js';

mongoose.set('strictQuery', true);
let closing = false;

export async function connectDb(uri = config.mongoUri) {
  mongoose.connection.on('disconnected', () => { if (!closing) logger.warn('MongoDB disconnected'); });
  mongoose.connection.on('reconnected', () => logger.info('MongoDB reconnected'));
  mongoose.connection.on('error', (err) => logger.error({ err }, 'MongoDB error'));
  await mongoose.connect(uri, {
    serverSelectionTimeoutMS: 10000,
    maxPoolSize: 20,
    // Scoring events must survive a crash: acknowledge only after the journal write.
    writeConcern: { w: 1, j: true },
  });
  logger.info({ db: mongoose.connection.name }, 'MongoDB connected');
  return mongoose.connection;
}

export async function disconnectDb() {
  closing = true;
  await mongoose.disconnect();
  closing = false;
}

export function dbState() {
  return ['disconnected', 'connected', 'connecting', 'disconnecting'][mongoose.connection.readyState] || 'unknown';
}

export async function pingDb() {
  const t = performance.now();
  await mongoose.connection.db.admin().ping();
  return +(performance.now() - t).toFixed(2);
}
