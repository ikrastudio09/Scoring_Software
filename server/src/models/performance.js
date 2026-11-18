import mongoose from 'mongoose';
import { PERFORMANCE_KEYS, SUPPLIED_RATES } from '@cricket/shared';

// One historical performance aggregate (previous year, overall previous, or an imported season).
// Built from PERFORMANCE_FIELDS in @cricket/shared — edit the field list there, not here.
// Absent field = not supplied by the source (never 0 by default).
export const performanceSchema = new mongoose.Schema({
  ...Object.fromEntries(PERFORMANCE_KEYS.map((k) => [k, { type: Number, min: 0 }])),
  // Rates exactly as a source supplied them; shown only when totals cannot produce them.
  supplied: Object.fromEntries(SUPPLIED_RATES.map((r) => [r.key, Number])),
  meta: {
    label: String, // as in the source, e.g. "2024" or "ASD − 2024"
    season: Number, // the season it covers (previous year)
    fromSeason: Number,
    toSeason: Number,
  },
}, { _id: false });
