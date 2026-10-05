import pino from 'pino';
import { config } from '../config/env.js';

export const logger = pino({
  level: config.isTest ? 'silent' : config.logLevel,
  base: { service: 'cricket-server' },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: { paths: ['req.headers.authorization', 'password', '*.password', 'passwordHash'], remove: true },
});
