import { ERROR_CODES } from '@cricket/shared';

/** An expected error with a safe, user-facing message. */
export class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const notFound = (what = 'Resource') => new AppError(404, ERROR_CODES.NOT_FOUND, `${what} not found`);
export const badRequest = (message, details) => new AppError(400, ERROR_CODES.VALIDATION, message, details);
export const conflict = (message, code = ERROR_CODES.CONFLICT, details) => new AppError(409, code, message, details);
export const forbidden = (message = 'Not allowed') => new AppError(403, ERROR_CODES.FORBIDDEN, message);
export const unauthorized = (message = 'Authentication required') => new AppError(401, ERROR_CODES.UNAUTHORIZED, message);
