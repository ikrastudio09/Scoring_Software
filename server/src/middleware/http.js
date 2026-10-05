import { ZodError } from 'zod';
import mongoose from 'mongoose';
import rateLimit from 'express-rate-limit';
import { ERROR_CODES } from '@cricket/shared';
import { logger } from '../utils/logger.js';
import { metrics } from '../utils/metrics.js';
import { config } from '../config/env.js';
import { verifyToken } from '../services/auth.js';
import { bearer } from './auth.js';

/** Validate and replace req.body / req.query with the parsed value. */
export const validate = (schema, where = 'body') => (req, _res, next) => {
  try {
    const parsed = schema.parse(req[where] ?? {});
    if (where === 'query') req.validQuery = parsed;
    else req[where] = parsed;
    next();
  } catch (err) {
    next(err);
  }
};

export function requestLogger(req, res, next) {
  const t0 = performance.now();
  res.on('finish', () => {
    const ms = performance.now() - t0;
    metrics.httpRequest(res.statusCode, ms);
    if (req.path === '/api/health') return;
    const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'debug';
    logger[level]({ method: req.method, url: req.originalUrl, status: res.statusCode, ms: +ms.toFixed(1), user: req.user?.username }, 'http');
  });
  next();
}

export function notFoundHandler(req, res) {
  res.status(404).json({ error: { code: ERROR_CODES.NOT_FOUND, message: `No route for ${req.method} ${req.path}` } });
}

// Every error leaves the server in this shape: { error: { code, message, details? } }.
// Stack traces are logged, never sent.
// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, _next) {
  if (err instanceof ZodError) {
    const issues = err.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
    return res.status(400).json({
      error: { code: ERROR_CODES.VALIDATION, message: issues.map((i) => (i.path ? `${i.path}: ${i.message}` : i.message)).join('; '), details: issues },
    });
  }
  if (err.name === 'ScoringError' || err.name === 'AppError') {
    return res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
  }
  if (err instanceof mongoose.Error.ValidationError) {
    return res.status(400).json({ error: { code: ERROR_CODES.VALIDATION, message: Object.values(err.errors).map((e) => e.message).join('; ') } });
  }
  if (err instanceof mongoose.Error.CastError) {
    return res.status(404).json({ error: { code: ERROR_CODES.NOT_FOUND, message: 'Not found' } });
  }
  if (err?.code === 11000) {
    const field = Object.keys(err.keyPattern || {}).join(', ');
    return res.status(409).json({ error: { code: ERROR_CODES.CONFLICT, message: `Duplicate value for ${field || 'a unique field'}` } });
  }
  if (err?.type === 'entity.parse.failed') {
    return res.status(400).json({ error: { code: ERROR_CODES.VALIDATION, message: 'Malformed JSON body' } });
  }
  if (err?.type === 'entity.too.large') {
    return res.status(413).json({ error: { code: ERROR_CODES.VALIDATION, message: 'Request body too large' } });
  }
  logger.error({ err, method: req.method, url: req.originalUrl }, 'unhandled error');
  return res.status(500).json({ error: { code: ERROR_CODES.INTERNAL, message: 'Something went wrong. The error has been logged.' } });
}

const limitHandler = (_req, res) => res.status(429).json({ error: { code: ERROR_CODES.RATE_LIMITED, message: 'Too many requests, slow down' } });

export const loginLimiter = rateLimit({
  windowMs: 60_000, limit: config.rateLimit.loginPerMinute, standardHeaders: 'draft-7', legacyHeaders: false, handler: limitHandler,
  skip: () => config.isTest,
});

// Public read API: generous per-IP limit (venue Wi-Fi puts many phones behind one IP).
export const publicLimiter = rateLimit({
  windowMs: 60_000, limit: config.rateLimit.publicPerMinute, standardHeaders: 'draft-7', legacyHeaders: false, handler: limitHandler,
  skip: (req) => config.isTest || req.method !== 'GET' || Boolean(verifyToken(bearer(req))),
});
