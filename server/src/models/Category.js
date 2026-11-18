import mongoose from 'mongoose';

export const CATEGORY_KEYS = ['mens', 'ladies', 'kids'];

// One independent competition inside a season (Men's, Ladies, Kids). Teams, players, matches and
// every statistic belong to exactly one category, so `category` (an id that already implies the
// season) is the scope of every tournament query.
//
// rules / points / impactWeights / leaderboards are OVERRIDES of the season defaults stored on the
// tournament document: a field that is not set here falls back to the season value
// (services/categories.js categoryConfig). Matches still freeze their rules at creation.
const categorySchema = new mongoose.Schema({
  season: { type: Number, required: true },
  key: { type: String, required: true, enum: CATEGORY_KEYS },
  name: { type: String, required: true, trim: true },
  shortName: { type: String, trim: true },
  order: { type: Number, default: 0 },
  active: { type: Boolean, default: true },
  rules: {
    oversPerInnings: Number,
    ballsPerOver: Number,
    maxOversPerBowler: Number,
    playersPerSide: Number,
    wideRuns: Number,
    noBallRuns: Number,
    freeHit: Boolean,
  },
  points: { type: mongoose.Schema.Types.Mixed, default: undefined },
  impactWeights: { type: mongoose.Schema.Types.Mixed },
  // Minimum volume for the rate-based leaderboards (strike rate, economy, average).
  leaderboards: {
    strikeRateMinBalls: Number,
    economyMinBalls: Number,
    averageMinInnings: Number,
    capMinMatches: Number,
  },
  // League stage format for the qualification predictor.
  qualification: {
    slots: Number,
  },
}, { timestamps: true });

categorySchema.index({ season: 1, key: 1 }, { unique: true });

export const Category = mongoose.model('Category', categorySchema);
