// E2E server: fresh database, sample tournament with 3 completed matches, built apps served.
process.env.NODE_ENV = 'e2e';
process.env.SERVE_STATIC = 'true';
process.env.LOG_LEVEL = 'warn';
process.env.RATE_LIMIT_PUBLIC_PER_MIN = '100000';
process.env.MONGODB_URI = process.env.E2E_MONGODB_URI || 'mongodb://127.0.0.1:27017/cricket_e2e';
process.env.ADMIN_USERNAME = 'admin';
process.env.ADMIN_PASSWORD = 'e2e-admin-password';
process.env.JWT_SECRET = 'e2e-secret-e2e-secret-e2e-secret-e2e';

const mongoose = (await import('mongoose')).default;
const { connectDb } = await import('../../server/src/db.js');
await connectDb(process.env.MONGODB_URI);
await mongoose.connection.db.dropDatabase();
const models = await import('../../server/src/models/index.js');
await Promise.all(Object.values(models).map((M) => M.syncIndexes()));
const { importTournament } = await import('../../server/scripts/lib/importer.js');
const { sampleTournament } = await import('../../server/scripts/seed.js');
const { playMatch } = await import('../../server/scripts/lib/simulate.js');
await importTournament(sampleTournament(), { log: () => {} });
// Shorter matches for E2E, and 3 completed results so stats/points pages have data.
await models.Match.updateMany({}, { $set: { 'rules.oversPerInnings': 2, 'rules.maxOversPerBowler': 1 } });
for (const n of [1, 2, 3]) {
  const m = await models.Match.findOne({ number: n });
  await playMatch(m._id, { seed: n });
}
const { startServer } = await import('../../server/src/index.js');
await startServer({ port: Number(process.env.E2E_PORT || 4100), mongoUri: process.env.MONGODB_URI });
console.log('e2e server ready');
