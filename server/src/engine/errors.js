/** A rule violation. Always safe to show to the scorer. */
export class ScoringError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = 'ScoringError';
    this.code = code;
    this.status = 422;
    this.details = details;
  }
}

export const fail = (code, message, details) => {
  throw new ScoringError(code, message, details);
};

