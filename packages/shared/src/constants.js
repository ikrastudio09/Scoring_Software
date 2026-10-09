// Contracts shared by the server and every client. Changing a value here is a protocol change.

export const MATCH_STATUS = Object.freeze({
  SCHEDULED: 'SCHEDULED',
  READY: 'READY',
  LIVE: 'LIVE',
  INNINGS_BREAK: 'INNINGS_BREAK',
  SECOND_INNINGS: 'SECOND_INNINGS',
  COMPLETED: 'COMPLETED',
  POSTPONED: 'POSTPONED',
  CANCELLED: 'CANCELLED',
  ABANDONED: 'ABANDONED',
});

export const IN_PLAY_STATUSES = Object.freeze([
  MATCH_STATUS.LIVE,
  MATCH_STATUS.INNINGS_BREAK,
  MATCH_STATUS.SECOND_INNINGS,
]);

export const MATCH_STAGES = Object.freeze(['league', 'qualifier', 'eliminator', 'quarter_final', 'semi_final', 'final']);

// Scoring command types (stored as MatchEvent.type).
export const EVENT_TYPES = Object.freeze({
  START_INNINGS: 'START_INNINGS',
  DELIVERY: 'DELIVERY',
  SET_BOWLER: 'SET_BOWLER',
  NEW_BATTER: 'NEW_BATTER',
  RETIRE: 'RETIRE',
  SWAP_STRIKE: 'SWAP_STRIKE',
  END_INNINGS: 'END_INNINGS',
  CONCLUDE: 'CONCLUDE',
  UNDO: 'UNDO',
});

export const EXTRA_TYPES = Object.freeze({
  WIDE: 'wide',
  NO_BALL: 'noball',
  BYE: 'bye',
  LEG_BYE: 'legbye',
});

export const DISMISSAL = Object.freeze({
  BOWLED: 'bowled',
  CAUGHT: 'caught',
  CAUGHT_AND_BOWLED: 'caught_and_bowled',
  LBW: 'lbw',
  RUN_OUT: 'run_out',
  STUMPED: 'stumped',
  HIT_WICKET: 'hit_wicket',
  OBSTRUCTING_FIELD: 'obstructing_field',
  HIT_BALL_TWICE: 'hit_ball_twice',
  RETIRED_OUT: 'retired_out',
  RETIRED_HURT: 'retired_hurt',
});

export const DISMISSAL_LABELS = Object.freeze({
  bowled: 'Bowled',
  caught: 'Caught',
  caught_and_bowled: 'Caught & Bowled',
  lbw: 'LBW',
  run_out: 'Run Out',
  stumped: 'Stumped',
  hit_wicket: 'Hit Wicket',
  obstructing_field: 'Obstructing the Field',
  hit_ball_twice: 'Hit the Ball Twice',
  retired_out: 'Retired Out',
  retired_hurt: 'Retired Hurt',
});

// Dismissals recorded on a delivery (retirements use the RETIRE command instead).
export const DELIVERY_DISMISSALS = Object.freeze([
  'bowled', 'caught', 'caught_and_bowled', 'lbw', 'run_out', 'stumped', 'hit_wicket',
  'obstructing_field', 'hit_ball_twice',
]);
export const FIELDER_DISMISSALS = Object.freeze(['caught', 'run_out', 'stumped']);
export const FIELDER_REQUIRED = Object.freeze(['caught']);
export const BOWLER_CREDITED = Object.freeze(['bowled', 'caught', 'caught_and_bowled', 'lbw', 'stumped', 'hit_wicket']);
// Dismissals of the non-striker are possible only for these.
export const EITHER_BATTER_DISMISSALS = Object.freeze(['run_out', 'obstructing_field']);

export const RESULT_TYPES = Object.freeze({
  WIN: 'win',
  TIE: 'tie',
  NO_RESULT: 'no_result',
  ABANDONED: 'abandoned',
  WALKOVER: 'walkover',
});

// Socket.IO event names (server → client envelope "type").
export const SOCKET_EVENTS = Object.freeze({
  MATCH_STARTED: 'MATCH_STARTED',
  BALL_RECORDED: 'BALL_RECORDED',
  OVER_COMPLETED: 'OVER_COMPLETED',
  WICKET: 'WICKET',
  INNINGS_COMPLETED: 'INNINGS_COMPLETED',
  MATCH_COMPLETED: 'MATCH_COMPLETED',
  EVENT_UNDONE: 'EVENT_UNDONE',
  MATCH_STATE_UPDATED: 'MATCH_STATE_UPDATED',
  MATCH_STATUS_CHANGED: 'MATCH_STATUS_CHANGED',
  POINTS_TABLE_UPDATED: 'POINTS_TABLE_UPDATED',
  STATISTICS_UPDATED: 'STATISTICS_UPDATED',
  // A scorer edited the commentary of one ball. Not a scoring change: carries no new version.
  COMMENTARY_UPDATED: 'COMMENTARY_UPDATED',
});

// Optional shot description a scorer may attach to a delivery (commentary only, never scoring).
export const SHOT_TYPES = Object.freeze({
  drive: 'Drive',
  cover_drive: 'Cover drive',
  straight_drive: 'Straight drive',
  flick: 'Flick',
  pull: 'Pull',
  hook: 'Hook',
  cut: 'Cut',
  sweep: 'Sweep',
  reverse_sweep: 'Reverse sweep',
  lofted: 'Lofted shot',
  edge: 'Edge',
  defence: 'Defence',
  leave: 'Leave',
});

// The single socket message name. Payload is the envelope {type, matchId, version, ...}.
export const SOCKET_MESSAGE = 'cricket:event';
export const SOCKET_SUBSCRIBE = 'cricket:subscribe';
export const SOCKET_UNSUBSCRIBE = 'cricket:unsubscribe';

export const CHANNELS = Object.freeze({ ADMIN: 'admin', LED: 'led', VIEWER: 'viewer' });

export const ROLES = Object.freeze({ ADMIN: 'admin', SCORER: 'scorer' });

export const ERROR_CODES = Object.freeze({
  VALIDATION: 'VALIDATION_ERROR',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  STALE_STATE: 'STALE_STATE',
  DUPLICATE_EVENT: 'DUPLICATE_EVENT',
  RATE_LIMITED: 'RATE_LIMITED',
  INTERNAL: 'INTERNAL_ERROR',
  // Scoring-domain errors
  INVALID_PLAYER: 'INVALID_PLAYER',
  INVALID_BOWLER: 'INVALID_BOWLER',
  BOWLER_LIMIT_REACHED: 'BOWLER_LIMIT_REACHED',
  CONSECUTIVE_OVERS: 'CONSECUTIVE_OVERS',
  BOWLER_REQUIRED: 'BOWLER_REQUIRED',
  BATTER_REQUIRED: 'BATTER_REQUIRED',
  INVALID_WICKET: 'INVALID_WICKET',
  INVALID_DELIVERY: 'INVALID_DELIVERY',
  INVALID_STRIKE_STATE: 'INVALID_STRIKE_STATE',
  INNINGS_NOT_IN_PROGRESS: 'INNINGS_NOT_IN_PROGRESS',
  INNINGS_COMPLETED: 'INNINGS_COMPLETED',
  MATCH_NOT_STARTED: 'MATCH_NOT_STARTED',
  MATCH_COMPLETED: 'MATCH_COMPLETED',
  MATCH_LOCKED: 'MATCH_LOCKED',
  INVALID_TRANSITION: 'INVALID_TRANSITION',
  NOTHING_TO_UNDO: 'NOTHING_TO_UNDO',
  // Only one match may be in play at a time (business rule, enforced server-side).
  ANOTHER_MATCH_ACTIVE: 'ANOTHER_MATCH_ACTIVE',
  IMPORT_INVALID: 'IMPORT_INVALID',
});
