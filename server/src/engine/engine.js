// Authoritative cricket scoring engine.
//
// Pure and synchronous: no I/O, no clocks, no randomness. Given the match setup and the ordered
// list of effective events, `replay` always produces the same state. `applyEvent` mutates the
// state it is given, so callers pass a clone and discard it if a ScoringError is thrown.

import { EVENT_TYPES, ERROR_CODES as E, RESULT_TYPES, SHOT_TYPES } from '@cricket/shared';
import { fail } from './errors.js';
import {
  allowsFielder, allowsRuns, canDismissEitherBatter, dismissalNotPossible, isBowlerCredited,
  isDeliveryDismissal, normalizeRules, requiresFielder,
} from './rules.js';

const SUPER_OVER_OVERS = 1;
const SUPER_OVER_WICKETS = 2;

export const MATCH_STATE = Object.freeze({
  NOT_STARTED: 'NOT_STARTED',
  IN_PROGRESS: 'IN_PROGRESS',
  INNINGS_BREAK: 'INNINGS_BREAK',
  COMPLETED: 'COMPLETED',
});

/**
 * setup = {
 *   rules: { oversPerInnings, ballsPerOver, maxOversPerBowler, wideRuns, noBallRuns, freeHit },
 *   battingFirst: teamId, bowlingFirst: teamId,
 *   xi: { [teamId]: [playerId, ...] },      // playing XI of each team
 *   superOver: boolean,                     // a tie goes to a Super Over (knockout matches)
 * }
 */
export function createState(setup) {
  validateSetup(setup);
  return {
    version: 0,
    status: MATCH_STATE.NOT_STARTED,
    innings: [],
    result: null,
    lastEvent: null,
  };
}

function validateSetup(setup) {
  if (!setup) throw new Error('Match setup is required');
  normalizeRules(setup.rules);
  const { battingFirst, bowlingFirst, xi } = setup;
  if (!battingFirst || !bowlingFirst || battingFirst === bowlingFirst) throw new Error('Invalid batting order');
  for (const t of [battingFirst, bowlingFirst]) {
    if (!Array.isArray(xi?.[t]) || xi[t].length < 2) throw new Error(`Playing XI for ${t} needs at least 2 players`);
  }
}

export function currentInnings(state) {
  return state.innings[state.innings.length - 1] || null;
}

/** Rebuild a state from scratch. `events` must be the effective (not undone) events in order. */
export function replay(setup, events) {
  let state = createState(setup);
  for (const ev of events) {
    applyEvent(state, setup, ev);
  }
  return state;
}

/**
 * Apply one event in place. Returns the list of effects (BALL, WICKET, OVER_COMPLETED, ...).
 * event = { type, payload, seq }
 */
export function applyEvent(state, setup, event) {
  const rules = normalizeRules(setup.rules);
  const ctx = { state, setup, rules, effects: [] };
  const p = event.payload || {};

  if (state.status === MATCH_STATE.COMPLETED) {
    fail(E.MATCH_COMPLETED, 'Match is already completed');
  }

  switch (event.type) {
    case EVENT_TYPES.START_INNINGS: startInnings(ctx, p); break;
    case EVENT_TYPES.DELIVERY: delivery(ctx, p, event.seq); break;
    case EVENT_TYPES.SET_BOWLER: setBowler(ctx, p); break;
    case EVENT_TYPES.NEW_BATTER: newBatter(ctx, p); break;
    case EVENT_TYPES.RETIRE: retire(ctx, p); break;
    case EVENT_TYPES.SWAP_STRIKE: swapStrikeCmd(ctx); break;
    case EVENT_TYPES.END_INNINGS: endInningsCmd(ctx, p); break;
    case EVENT_TYPES.CONCLUDE: conclude(ctx, p); break;
    default: fail(E.VALIDATION, `Unknown event type: ${event.type}`);
  }

  state.version = event.seq ?? state.version + 1;
  state.lastEvent = { type: event.type, seq: state.version, effects: ctx.effects, label: ctx.label || null };
  return ctx.effects;
}

// ─── helpers ──────────────────────────────────────────────────────────────────────────────────

function liveInnings(state) {
  const inn = currentInnings(state);
  if (state.status === MATCH_STATE.NOT_STARTED) fail(E.MATCH_NOT_STARTED, 'Innings has not started');
  if (!inn || inn.status !== 'IN_PROGRESS') fail(E.INNINGS_NOT_IN_PROGRESS, 'No innings in progress');
  return inn;
}

function inXI(setup, team, id) {
  return Boolean(id) && setup.xi[team].includes(id);
}

function newBatterRecord(id, position) {
  return { id, position, runs: 0, balls: 0, fours: 0, sixes: 0, dots: 0, status: 'batting', dismissal: null };
}

function bowlerRecord(inn, id) {
  if (!inn.bowlers[id]) {
    inn.bowlers[id] = {
      id, legalBalls: 0, runs: 0, wickets: 0, maidens: 0, dots: 0, wides: 0, noBalls: 0,
      fours: 0, sixes: 0, oversStarted: 0,
    };
    inn.bowlingOrder.push(id);
  }
  return inn.bowlers[id];
}

function openOver(inn) {
  const last = inn.overs[inn.overs.length - 1];
  return last && !last.completed ? last : null;
}

function swap(inn) {
  [inn.striker, inn.nonStriker] = [inn.nonStriker, inn.striker];
}

function startPartnershipIfReady(inn) {
  if (inn.currentPartnership || !inn.striker || !inn.nonStriker) return;
  inn.currentPartnership = {
    wicket: inn.wickets + 1,
    batters: [inn.striker, inn.nonStriker],
    contributions: { [inn.striker]: { runs: 0, balls: 0 }, [inn.nonStriker]: { runs: 0, balls: 0 } },
    runs: 0,
    balls: 0,
    startScore: inn.runs,
  };
}

function closePartnership(inn, endedBy) {
  if (!inn.currentPartnership) return;
  inn.partnerships.push({ ...inn.currentPartnership, endedBy });
  inn.currentPartnership = null;
}

// ─── commands ─────────────────────────────────────────────────────────────────────────────────

function startInnings(ctx, p) {
  const { state, setup, rules } = ctx;
  if (state.status !== MATCH_STATE.NOT_STARTED && state.status !== MATCH_STATE.INNINGS_BREAK) {
    fail(E.INVALID_TRANSITION, 'An innings is already in progress');
  }
  const number = state.innings.length + 1;
  const { battingTeam, bowlingTeam } = nextInningsTeams(state, setup);
  const { strikerId, nonStrikerId, bowlerId } = p;

  if (!inXI(setup, battingTeam, strikerId)) fail(E.INVALID_PLAYER, 'Striker is not in the batting XI');
  if (!inXI(setup, battingTeam, nonStrikerId)) fail(E.INVALID_PLAYER, 'Non-striker is not in the batting XI');
  if (strikerId === nonStrikerId) fail(E.INVALID_PLAYER, 'Striker and non-striker must be different players');
  if (!inXI(setup, bowlingTeam, bowlerId)) fail(E.INVALID_BOWLER, 'Bowler is not in the bowling XI');

  // Innings 3+ are Super Overs, played in pairs: one over and two wickets per side.
  const superOver = number > 2 ? Math.ceil((number - 2) / 2) : null;
  const inn = {
    number,
    superOver,
    battingTeam,
    bowlingTeam,
    status: 'IN_PROGRESS',
    endReason: null,
    runs: 0,
    wickets: 0,
    legalBalls: 0,
    maxBalls: (superOver ? SUPER_OVER_OVERS : rules.oversPerInnings) * rules.ballsPerOver,
    maxWickets: Math.min(setup.xi[battingTeam].length - 1, superOver ? SUPER_OVER_WICKETS : Infinity),
    // The second innings of each pair chases the first.
    target: number % 2 === 0 ? state.innings[number - 2].runs + 1 : null,
    extras: { wides: 0, noBalls: 0, byes: 0, legByes: 0, total: 0 },
    striker: strikerId,
    nonStriker: nonStrikerId,
    bowler: null,
    freeHit: false,
    batters: {
      [strikerId]: newBatterRecord(strikerId, 1),
      [nonStrikerId]: newBatterRecord(nonStrikerId, 2),
    },
    battingOrder: [strikerId, nonStrikerId],
    bowlers: {},
    bowlingOrder: [],
    overs: [],
    previousOverBowlers: [],
    fallOfWickets: [],
    partnerships: [],
    currentPartnership: null,
  };
  state.innings.push(inn);
  state.status = MATCH_STATE.IN_PROGRESS;
  startPartnershipIfReady(inn);
  assignBowler(ctx, inn, bowlerId);
  ctx.effects.push(number === 1 ? 'MATCH_STARTED' : 'INNINGS_STARTED');
}

/**
 * Which side bats in the next innings. Innings 1–2 follow the toss; in every Super Over the side
 * that batted second in the previous pair bats first (ICC playing conditions).
 */
export function nextInningsTeams(state, setup) {
  const n = state.innings.length + 1;
  let battingTeam;
  if (n === 1) battingTeam = setup.battingFirst;
  else if (n % 2 === 0) battingTeam = state.innings[n - 2].bowlingTeam;
  else battingTeam = state.innings[n - 2].battingTeam;
  return { battingTeam, bowlingTeam: battingTeam === setup.battingFirst ? setup.bowlingFirst : setup.battingFirst };
}

/** Bowler availability for the next/current over. Returns null if allowed, else {code, message}. */
export function bowlerUnavailableReason(inn, rules, bowlerId) {
  const over = openOver(inn);
  const rec = inn.bowlers[bowlerId];
  if (over && inn.bowler === bowlerId) return { code: E.INVALID_BOWLER, message: 'Already bowling this over' };
  // Anyone else listed on the open over has delivered in it (unused picks are removed).
  if (over && over.bowlers.includes(bowlerId)) return { code: E.INVALID_BOWLER, message: 'Already bowled in this over' };
  if (inn.previousOverBowlers.includes(bowlerId)) {
    return { code: E.CONSECUTIVE_OVERS, message: 'Bowled the previous over' };
  }
  // A part over counts as a full over towards the limit (ICC playing conditions).
  if (rec && rec.oversStarted >= rules.maxOversPerBowler) {
    return { code: E.BOWLER_LIMIT_REACHED, message: `Reached the limit of ${rules.maxOversPerBowler} overs` };
  }
  return null;
}

function assignBowler(ctx, inn, bowlerId) {
  const { setup, rules } = ctx;
  if (!inXI(setup, inn.bowlingTeam, bowlerId)) fail(E.INVALID_BOWLER, 'Bowler is not in the bowling XI');
  const reason = bowlerUnavailableReason(inn, rules, bowlerId);
  if (reason) fail(reason.code, `Bowler not allowed: ${reason.message}`);

  let over = openOver(inn);
  if (!over) {
    over = {
      index: inn.overs.length,
      bowlers: [],
      balls: [],
      runs: 0,
      wickets: 0,
      legalBalls: 0,
      illegalBalls: 0,
      bowlerConceded: 0,
      completed: false,
    };
    inn.overs.push(over);
  }
  // A bowler who was set but has not delivered a ball yet is simply replaced (a correction).
  if (inn.bowler && !over.balls.some((b) => b.bowler === inn.bowler)) {
    over.bowlers = over.bowlers.filter((id) => id !== inn.bowler);
  }
  if (!over.bowlers.includes(bowlerId)) over.bowlers.push(bowlerId);
  bowlerRecord(inn, bowlerId);
  inn.bowler = bowlerId;
}

function setBowler(ctx, p) {
  const inn = liveInnings(ctx.state);
  const over = openOver(inn);
  if (over && inn.bowler && over.balls.length > 0 && !p.midOver) {
    fail(E.INVALID_BOWLER, 'Over in progress: confirm a mid-over bowler change');
  }
  assignBowler(ctx, inn, p.bowlerId);
  ctx.effects.push('BOWLER_CHANGED');
}

function newBatter(ctx, p) {
  const { setup } = ctx;
  const inn = liveInnings(ctx.state);
  const { batterId } = p;
  if (inn.striker && inn.nonStriker) fail(E.INVALID_STRIKE_STATE, 'Both batters are already at the crease');
  if (!inXI(setup, inn.battingTeam, batterId)) fail(E.INVALID_PLAYER, 'Batter is not in the batting XI');
  const rec = inn.batters[batterId];
  if (rec && rec.status !== 'retired_hurt') fail(E.INVALID_PLAYER, 'Batter has already batted');

  if (rec) {
    rec.status = 'batting'; // returning retired-hurt batter resumes the innings
    rec.dismissal = null;
  } else {
    inn.batters[batterId] = newBatterRecord(batterId, inn.battingOrder.length + 1);
    inn.battingOrder.push(batterId);
  }
  // Fill the vacant end; `end` only matters in the rare case both ends are vacant.
  if (p.end === 'nonStriker' && !inn.nonStriker) inn.nonStriker = batterId;
  else if (!inn.striker) inn.striker = batterId;
  else inn.nonStriker = batterId;
  startPartnershipIfReady(inn);
  ctx.effects.push('BATTER_CHANGED');
}

function swapStrikeCmd(ctx) {
  const inn = liveInnings(ctx.state);
  swap(inn);
  ctx.effects.push('STRIKE_CHANGED');
}

function retire(ctx, p) {
  const inn = liveInnings(ctx.state);
  const { batterId, kind } = p;
  if (batterId !== inn.striker && batterId !== inn.nonStriker) {
    fail(E.INVALID_PLAYER, 'Only a batter at the crease can retire');
  }
  if (kind !== 'retired_hurt' && kind !== 'retired_out') fail(E.VALIDATION, 'Retirement must be retired_hurt or retired_out');
  const rec = inn.batters[batterId];
  rec.dismissal = { type: kind, bowler: null, fielder: null };
  if (batterId === inn.striker) inn.striker = null;
  else inn.nonStriker = null;

  if (kind === 'retired_out') {
    rec.status = 'out';
    inn.wickets += 1;
    inn.fallOfWickets.push({ wicket: inn.wickets, runs: inn.runs, batter: batterId, legalBalls: inn.legalBalls });
    closePartnership(inn, 'wicket');
    ctx.effects.push('WICKET');
    if (inn.wickets >= inn.maxWickets) completeInnings(ctx, inn, 'all_out');
  } else {
    rec.status = 'retired_hurt';
    closePartnership(inn, 'retired');
    ctx.effects.push('BATTER_CHANGED');
  }
}

function endInningsCmd(ctx, p) {
  const inn = liveInnings(ctx.state);
  completeInnings(ctx, inn, p.reason || 'declared');
}

function conclude(ctx, p) {
  const { state, setup } = ctx;
  const { resultType, winnerTeamId } = p;
  if (![RESULT_TYPES.NO_RESULT, RESULT_TYPES.ABANDONED, RESULT_TYPES.WALKOVER].includes(resultType)) {
    fail(E.VALIDATION, 'resultType must be no_result, abandoned or walkover');
  }
  const teams = [setup.battingFirst, setup.bowlingFirst];
  if (resultType === RESULT_TYPES.WALKOVER && !teams.includes(winnerTeamId)) {
    fail(E.VALIDATION, 'Walkover needs a winning team from this match');
  }
  const inn = currentInnings(state);
  if (inn && inn.status === 'IN_PROGRESS') {
    inn.status = 'COMPLETED';
    inn.endReason = 'match_concluded';
    closeOpenOver(inn);
    closePartnership(inn, 'innings_end');
  }
  state.result = resultType === RESULT_TYPES.WALKOVER
    ? { type: RESULT_TYPES.WALKOVER, winner: winnerTeamId, loser: teams.find((t) => t !== winnerTeamId) }
    : { type: resultType, winner: null, loser: null };
  state.status = MATCH_STATE.COMPLETED;
  ctx.effects.push('MATCH_COMPLETED');
}

// ─── delivery ─────────────────────────────────────────────────────────────────────────────────

const EXTRA_KINDS = new Set([null, 'wide', 'noball', 'bye', 'legbye']);

function delivery(ctx, p, seq) {
  const { state, setup, rules } = ctx;
  const inn = liveInnings(state);
  if (!inn.striker || !inn.nonStriker) fail(E.BATTER_REQUIRED, 'Select the new batter before the next delivery');
  if (!inn.bowler) fail(E.BOWLER_REQUIRED, 'Select the bowler for this over');

  const extra = p.extra ?? null;
  const runs = p.runs ?? 0;
  const boundary = Boolean(p.boundary);
  const noBallRunsType = extra === 'noball' ? (p.noBallRunsType || 'bat') : null;
  const freeHit = inn.freeHit;

  if (!EXTRA_KINDS.has(extra)) fail(E.INVALID_DELIVERY, `Unknown extra type: ${extra}`);
  if (!Number.isInteger(runs) || runs < 0 || runs > 7) fail(E.INVALID_DELIVERY, 'Runs must be a whole number from 0 to 7');
  if (noBallRunsType && !['bat', 'bye', 'legbye'].includes(noBallRunsType)) {
    fail(E.INVALID_DELIVERY, 'No-ball runs must be off the bat, byes or leg byes');
  }
  const offBat = extra === null || (extra === 'noball' && noBallRunsType === 'bat');
  if (boundary && runs !== 4 && runs !== 6) fail(E.INVALID_DELIVERY, 'A boundary is worth 4 or 6');
  if (boundary && runs === 6 && !offBat) fail(E.INVALID_DELIVERY, 'Six can only be scored off the bat');
  // Optional shot description: commentary only, never affects the score.
  const shot = p.shot ?? null;
  if (shot !== null && !Object.hasOwn(SHOT_TYPES, shot)) fail(E.INVALID_DELIVERY, `Unknown shot type: ${shot}`);

  // ── wicket validation (before any mutation) ──
  const w = p.wicket || null;
  let dismissedId = null;
  if (w) {
    if (!isDeliveryDismissal(w.type)) fail(E.INVALID_WICKET, `Unknown dismissal type: ${w.type}`);
    const notPossible = dismissalNotPossible(w.type, { extra, freeHit });
    if (notPossible) fail(E.INVALID_WICKET, notPossible[0].toUpperCase() + notPossible.slice(1));
    if (!allowsRuns(w.type) && runs > 0) fail(E.INVALID_WICKET, 'No runs can be scored on this dismissal');
    if (canDismissEitherBatter(w.type)) {
      dismissedId = w.batterId || inn.striker;
      if (dismissedId !== inn.striker && dismissedId !== inn.nonStriker) {
        fail(E.INVALID_WICKET, 'Dismissed batter must be one of the two batters at the crease');
      }
    } else {
      if (w.batterId && w.batterId !== inn.striker) fail(E.INVALID_WICKET, 'Only the striker can be out this way');
      dismissedId = inn.striker;
    }
    if (w.fielderId && !allowsFielder(w.type)) fail(E.INVALID_WICKET, 'This dismissal does not involve a fielder');
    if (requiresFielder(w.type) && !w.fielderId && !w.substituteFielder) fail(E.INVALID_WICKET, 'Select the fielder');
    if (w.fielderId && !inXI(setup, inn.bowlingTeam, w.fielderId)) fail(E.INVALID_WICKET, 'Fielder is not in the fielding XI');
  }

  // ── run attribution ──
  const penalty = extra === 'wide' ? rules.wideRuns : extra === 'noball' ? rules.noBallRuns : 0;
  const legal = extra !== 'wide' && extra !== 'noball';
  const batRuns = offBat ? runs : 0;
  const wides = extra === 'wide' ? penalty + runs : 0;
  const noBalls = extra === 'noball' ? penalty : 0;
  const byes = extra === 'bye' || noBallRunsType === 'bye' ? runs : 0;
  const legByes = extra === 'legbye' || noBallRunsType === 'legbye' ? runs : 0;
  const total = penalty + runs;
  const bowlerConceded = batRuns + wides + noBalls; // byes and leg byes are not charged to the bowler

  const strikerId = inn.striker;
  const bowlerId = inn.bowler;
  const striker = inn.batters[strikerId];
  const bowler = bowlerRecord(inn, bowlerId);
  const over = openOver(inn);

  // Bowler's over count: first ball (of any kind) by this bowler in this over.
  if (!over.balls.some((b) => b.bowler === bowlerId)) bowler.oversStarted += 1;

  inn.runs += total;
  inn.extras.wides += wides;
  inn.extras.noBalls += noBalls;
  inn.extras.byes += byes;
  inn.extras.legByes += legByes;
  inn.extras.total += wides + noBalls + byes + legByes;

  if (extra !== 'wide') {
    striker.balls += 1; // no-balls count as balls faced; wides do not
    if (batRuns === 0) striker.dots += 1;
  }
  striker.runs += batRuns;
  const four = boundary && runs === 4 && offBat;
  const six = boundary && runs === 6 && offBat;
  if (four) { striker.fours += 1; bowler.fours += 1; }
  if (six) { striker.sixes += 1; bowler.sixes += 1; }

  bowler.runs += bowlerConceded;
  if (legal) {
    bowler.legalBalls += 1;
    if (bowlerConceded === 0) bowler.dots += 1;
  }
  if (extra === 'wide') bowler.wides += 1;
  if (extra === 'noball') bowler.noBalls += 1;

  if (legal) inn.legalBalls += 1;

  const part = inn.currentPartnership;
  if (part) {
    part.runs += total;
    if (legal) part.balls += 1;
    if (part.contributions[strikerId]) {
      part.contributions[strikerId].runs += batRuns;
      if (extra !== 'wide') part.contributions[strikerId].balls += 1;
    }
  }

  // ── strike: batters cross on every odd number of runs completed ──
  if (runs % 2 === 1) swap(inn);

  // ── wicket ──
  if (w) {
    const out = inn.batters[dismissedId];
    const fielder = w.type === 'caught_and_bowled' ? bowlerId : (w.fielderId || null);
    out.status = 'out';
    out.dismissal = {
      type: w.type,
      bowler: isBowlerCredited(w.type) ? bowlerId : null,
      fielder,
      substituteFielder: Boolean(w.substituteFielder && !w.fielderId),
    };
    if (isBowlerCredited(w.type)) bowler.wickets += 1;
    inn.wickets += 1;
    over.wickets += 1;
    inn.fallOfWickets.push({ wicket: inn.wickets, runs: inn.runs, batter: dismissedId, legalBalls: inn.legalBalls });
    closePartnership(inn, 'wicket');
    // New batter comes in at the dismissed batter's end. Caught (Law 18.11): the striker's end,
    // and since no runs can be scored on a catch the dismissed striker is still the striker.
    if (inn.striker === dismissedId) inn.striker = null;
    else inn.nonStriker = null;
    ctx.effects.push('WICKET');
  }

  // ── ball record ──
  const ball = {
    seq,
    bowler: bowlerId,
    batter: strikerId,
    runs,
    total,
    batRuns,
    extra,
    noBallRunsType,
    legal,
    boundary: four ? 4 : six ? 6 : null,
    wicket: w ? { type: w.type, batter: dismissedId } : null,
    freeHit,
    shot,
    label: ballLabel({ extra, runs, total, noBallRunsType, wicket: Boolean(w) }),
  };
  over.balls.push(ball);
  over.runs += total;
  over.bowlerConceded += bowlerConceded;
  if (legal) over.legalBalls += 1;
  else over.illegalBalls += 1;

  ctx.label = ball.label;
  ctx.effects.push('BALL');
  if (four) ctx.effects.push('FOUR');
  if (six) ctx.effects.push('SIX');
  if (!legal || byes || legByes) ctx.effects.push('EXTRA');

  // ── free hit for the next delivery ──
  inn.freeHit = rules.freeHit && (extra === 'noball' || (freeHit && extra === 'wide'));
  if (inn.freeHit) ctx.effects.push('FREE_HIT');

  // ── end of innings / over ──
  const reason = inningsEndReason(inn);
  if (legal && over.legalBalls >= rules.ballsPerOver) {
    completeOver(ctx, inn, over, !reason);
  }
  if (reason) completeInnings(ctx, inn, reason);
}

function ballLabel({ extra, runs, total, noBallRunsType, wicket }) {
  let s;
  switch (extra) {
    case 'wide': s = total === 1 ? 'Wd' : `${total}Wd`; break;
    case 'noball':
      s = runs === 0 ? 'Nb' : `Nb+${runs}${noBallRunsType === 'bye' ? 'b' : noBallRunsType === 'legbye' ? 'lb' : ''}`;
      break;
    case 'bye': s = `${runs}B`; break;
    case 'legbye': s = `${runs}LB`; break;
    default: s = String(runs);
  }
  if (!wicket) return s;
  return s === '0' ? 'W' : `${s}+W`;
}

function inningsEndReason(inn) {
  if (inn.target !== null && inn.runs >= inn.target) return 'target_reached';
  if (inn.wickets >= inn.maxWickets) return 'all_out';
  if (inn.legalBalls >= inn.maxBalls) return 'overs_complete';
  return null;
}

function completeOver(ctx, inn, over, changeEnds) {
  over.completed = true;
  // Maiden: a complete over by one bowler in which the bowler conceded nothing.
  if (over.bowlers.length === 1 && over.bowlerConceded === 0) {
    inn.bowlers[over.bowlers[0]].maidens += 1;
  }
  inn.previousOverBowlers = over.balls.map((b) => b.bowler).filter((id, i, a) => a.indexOf(id) === i);
  inn.bowler = null;
  if (changeEnds) swap(inn); // the vacant slot of a last-ball wicket moves too, which is correct
  ctx.effects.push('OVER_COMPLETED');
}

function closeOpenOver(inn) {
  const over = openOver(inn);
  if (!over) return;
  if (over.balls.length === 0) inn.overs.pop();
  else over.completed = true;
}

function completeInnings(ctx, inn, reason) {
  const { state } = ctx;
  inn.status = 'COMPLETED';
  inn.endReason = reason;
  inn.freeHit = false;
  closeOpenOver(inn);
  closePartnership(inn, 'innings_end');
  ctx.effects.push('INNINGS_COMPLETED');
  if (inn.number % 2 === 1) {
    state.status = MATCH_STATE.INNINGS_BREAK;
    return;
  }
  const result = computeResult(state);
  if (result.type === RESULT_TYPES.TIE && ctx.setup.superOver) {
    // Scores level in a knockout: a Super Over (and another, until there is a winner).
    state.status = MATCH_STATE.INNINGS_BREAK;
    ctx.effects.push('SUPER_OVER');
    return;
  }
  state.result = result;
  state.status = MATCH_STATE.COMPLETED;
  ctx.effects.push('MATCH_COMPLETED');
}

/** Result of the last completed pair of innings (the match itself, or the deciding Super Over). */
export function computeResult(state) {
  const n = state.innings.length;
  const first = state.innings[n - 2];
  const second = state.innings[n - 1];
  if (second.superOver) {
    if (second.runs === first.runs) return { type: RESULT_TYPES.TIE, winner: null, loser: null };
    const chased = second.runs > first.runs;
    return {
      type: RESULT_TYPES.WIN,
      winner: chased ? second.battingTeam : first.battingTeam,
      loser: chased ? first.battingTeam : second.battingTeam,
      superOver: true,
    };
  }
  if (second.runs >= second.target) {
    return {
      type: RESULT_TYPES.WIN,
      winner: second.battingTeam,
      loser: first.battingTeam,
      marginWickets: Math.max(second.maxWickets - second.wickets, 0),
      ballsRemaining: Math.max(second.maxBalls - second.legalBalls, 0),
    };
  }
  if (second.runs === first.runs) return { type: RESULT_TYPES.TIE, winner: null, loser: null };
  return {
    type: RESULT_TYPES.WIN,
    winner: first.battingTeam,
    loser: second.battingTeam,
    marginRuns: first.runs - second.runs,
  };
}
