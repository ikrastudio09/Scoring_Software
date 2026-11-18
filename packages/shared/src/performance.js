// Historical performance aggregates: ONE definition used by the database schema, request
// validation, the auction "Previous Statistics" parser, the admin editor and the profile pages.
// To add or remove a statistic before production, edit PERFORMANCE_FIELDS (and STAT_CODES if the
// source files use a new short code) — everything else follows.
//
// An aggregate holds COUNTING totals only. A field is null/absent when the source did not supply
// it; it is never guessed. Rates (average, strike rate, economy) are derived from totals when the
// denominators exist, and otherwise only shown as `supplied` by the source — never averaged.

/** Counting fields of an aggregate, in display order. */
export const PERFORMANCE_FIELDS = Object.freeze([
  { key: 'seasons', label: 'Seasons', short: 'S' },
  { key: 'matches', label: 'Matches', short: 'M' },
  { key: 'innings', label: 'Innings', short: 'Inns' },
  { key: 'runs', label: 'Runs', short: 'R' },
  { key: 'ballsFaced', label: 'Balls faced', short: 'BF' },
  { key: 'notOuts', label: 'Not outs', short: 'NO' },
  { key: 'fours', label: 'Fours', short: '4s' },
  { key: 'sixes', label: 'Sixes', short: '6s' },
  { key: 'wickets', label: 'Wickets', short: 'W' },
  { key: 'ballsBowled', label: 'Balls bowled', short: 'BB' },
  { key: 'runsConceded', label: 'Runs conceded', short: 'RC' },
  { key: 'catches', label: 'Catches', short: 'C' },
  { key: 'runOuts', label: 'Run outs', short: 'RO' },
  { key: 'stumpings', label: 'Stumpings', short: 'St' },
  { key: 'playerOfMatch', label: 'Player of the match', short: 'MOM' },
]);
export const PERFORMANCE_KEYS = Object.freeze(PERFORMANCE_FIELDS.map((f) => f.key));

/** Rates kept exactly as a source supplied them (used only when totals cannot produce them). */
export const SUPPLIED_RATES = Object.freeze([
  { key: 'battingAvg', label: 'Batting average' },
  { key: 'strikeRate', label: 'Strike rate' },
  { key: 'economy', label: 'Economy' },
  { key: 'bowlingAvg', label: 'Bowling average' },
]);

/** Short codes used in the auction "Previous Statistics" text → field. */
export const STAT_CODES = Object.freeze({
  S: 'seasons', M: 'matches', I: 'innings', R: 'runs', B: 'ballsFaced', BF: 'ballsFaced', NO: 'notOuts',
  '4S': 'fours', '6S': 'sixes', W: 'wickets', BB: 'ballsBowled', RC: 'runsConceded',
  C: 'catches', RO: 'runOuts', ST: 'stumpings', MOM: 'playerOfMatch', POM: 'playerOfMatch', POTM: 'playerOfMatch',
});

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/** "M 10 · R 41 · W 4" — the fields an aggregate has, with their short labels; null when empty. */
export function performanceText(perf) {
  const parts = PERFORMANCE_FIELDS.filter((f) => isNum(perf?.[f.key])).map((f) => `${f.short} ${perf[f.key]}`);
  return parts.length ? parts.join(' · ') : null;
}

/** Only the counting fields that are present (a copy). */
export function totalsOf(perf) {
  const out = {};
  if (!perf) return out;
  for (const k of PERFORMANCE_KEYS) if (isNum(perf[k])) out[k] = perf[k];
  return out;
}

/**
 * Sum several aggregates (e.g. overall previous + previous year + current season). A field is
 * included only when EVERY part has it, so a career total is never a partial sum presented as
 * complete; `partial` lists the fields some parts lacked. Null parts (did not play) are skipped.
 */
export function combinePerformances(parts) {
  const present = parts.filter(Boolean);
  if (!present.length) return { totals: null, partial: [] };
  const totals = {};
  const partial = [];
  for (const k of PERFORMANCE_KEYS) {
    const have = present.filter((p) => isNum(p[k]));
    if (have.length === present.length) totals[k] = have.reduce((s, p) => s + p[k], 0);
    else if (have.length) partial.push(k);
  }
  return { totals, partial };
}

const round2 = (n) => Math.round(n * 100) / 100;

/** Rates derivable from the totals; null where a denominator is missing. Supplied values are not used. */
export function performanceRates(perf, ballsPerOver = 6) {
  const p = perf || {};
  const outs = isNum(p.innings) && isNum(p.notOuts) ? p.innings - p.notOuts : null;
  return {
    battingAvg: isNum(p.runs) && outs > 0 ? round2(p.runs / outs) : null,
    strikeRate: isNum(p.runs) && p.ballsFaced > 0 ? round2((p.runs / p.ballsFaced) * 100) : null,
    economy: isNum(p.runsConceded) && p.ballsBowled > 0 ? round2((p.runsConceded / p.ballsBowled) * ballsPerOver) : null,
    bowlingAvg: isNum(p.runsConceded) && p.wickets > 0 ? round2(p.runsConceded / p.wickets) : null,
  };
}

const EMPTY_TEXT = /^(n\/?a|null|nil|none|-|—)?$/i;

/**
 * Parse the auction "Previous Statistics" text, e.g.
 *   "ASD:- S-10, M-63, R-380, W-57, C-18, MOM-10 | 2024:- M-10, R-41, W-4, C-3"
 * → { segments: [{ label, kind: 'all'|'year', values: {seasons:10, …}, unknown: [] }], empty, error }
 * "N/A", "NULL" and blanks mean no previous record. Pure; never throws.
 */
export function parsePreviousStatistics(input) {
  const text = input === null || input === undefined ? '' : String(input).trim();
  if (EMPTY_TEXT.test(text)) return { segments: [], empty: true, error: null };
  const segments = [];
  for (const part of text.split('|').map((s) => s.trim()).filter(Boolean)) {
    const m = part.match(/^([^:]+?)\s*:-?\s*(.*)$/);
    if (!m) return { segments, empty: false, error: `Cannot read "${part}" (expected "LABEL:- CODE-value, …")` };
    const label = m[1].trim();
    const kind = /^(asd|all|overall|career|total)/i.test(label) ? 'all' : 'year';
    const values = {};
    const unknown = [];
    for (const item of m[2].split(',').map((s) => s.trim()).filter(Boolean)) {
      const kv = item.match(/^([A-Za-z0-9]+)\s*[-:=]\s*(-?\d+)$/);
      if (!kv) return { segments, empty: false, error: `Cannot read "${item}" in "${label}"` };
      const key = STAT_CODES[kv[1].toUpperCase()];
      if (!key) { unknown.push(kv[1]); continue; }
      values[key] = Number(kv[2]);
    }
    segments.push({ label, kind, values, unknown });
  }
  return { segments, empty: !segments.length, error: null };
}

/**
 * Split parsed statistics into the two aggregates the scoring system keeps apart:
 *   previousYear     the immediately preceding season (the dated segment)
 *   overallPrevious  every season BEFORE that one
 * The auction's all-seasons total ("ASD") INCLUDES the previous year, so overallPrevious =
 * ASD − previous year, field by field (exact for counting totals). A field that would go negative
 * is dropped and flagged rather than guessed. When ASD's MOM equals the previous year's matches
 * (a known shifted column in the export) it is dropped and flagged.
 *
 * Returns { previousYear, overallPrevious, flags: [{ code, message }] } — null blocks = no record.
 */
export function derivePreviousPerformance(parsed) {
  const flags = [];
  if (parsed.error) return { previousYear: null, overallPrevious: null, flags: [{ code: 'HISTORY_UNREADABLE', message: parsed.error }] };
  const all = parsed.segments.filter((s) => s.kind === 'all');
  const years = parsed.segments.filter((s) => s.kind === 'year');
  for (const s of parsed.segments) {
    if (s.unknown.length) flags.push({ code: 'HISTORY_UNKNOWN_CODE', message: `Ignored unknown code${s.unknown.length > 1 ? 's' : ''} ${s.unknown.join(', ')} in "${s.label}".` });
  }
  if (all.length > 1) flags.push({ code: 'HISTORY_SEGMENTS', message: 'More than one all-seasons segment; the first was used.' });
  if (years.length > 1) flags.push({ code: 'HISTORY_SEGMENTS', message: `More than one season segment (${years.map((y) => y.label).join(', ')}); the last was used as the previous year.` });
  const asd = all[0]?.values || null;
  const prevSeg = years[years.length - 1] || null;
  const prev = prevSeg ? { ...prevSeg.values } : null;
  if (prev) prev.seasons = 1;

  let overall = null;
  if (asd) {
    const total = { ...asd };
    if (prev && isNum(total.playerOfMatch) && isNum(prev.matches) && total.playerOfMatch === prev.matches) {
      delete total.playerOfMatch;
      flags.push({ code: 'HISTORY_MOM_UNRELIABLE', message: `All-seasons MOM (${asd.playerOfMatch}) equals last season's matches — treated as an export error and not imported.` });
    }
    overall = {};
    for (const k of PERFORMANCE_KEYS) {
      if (!isNum(total[k])) continue;
      if (!prev) { overall[k] = total[k]; continue; }
      if (!isNum(prev[k])) {
        // The previous year does not report this field: it cannot be separated from the total.
        if (k !== 'playerOfMatch') flags.push({ code: 'HISTORY_NOT_SEPARABLE', message: `${k} is given for all seasons but not for ${prevSeg.label}; it was not imported.` });
        continue;
      }
      const v = total[k] - prev[k];
      if (v < 0) { flags.push({ code: 'HISTORY_INCONSISTENT', message: `${k}: all seasons (${total[k]}) is less than ${prevSeg.label} (${prev[k]}); not imported.` }); continue; }
      overall[k] = v;
    }
    // Played only last season: nothing before it.
    if (prev && overall.seasons === 0) overall = null;
  } else if (prev) {
    flags.push({ code: 'HISTORY_NO_TOTAL', message: `Only ${prevSeg.label} is given; earlier seasons are unknown.` });
  }
  const meta = (block, extra) => (block ? { ...block, meta: extra } : null);
  return {
    previousYear: meta(prev, prevSeg ? { label: prevSeg.label } : null),
    overallPrevious: meta(overall, { label: asd ? `${all[0].label}${prev ? ` − ${prevSeg.label}` : ''}` : null }),
    flags,
  };
}
