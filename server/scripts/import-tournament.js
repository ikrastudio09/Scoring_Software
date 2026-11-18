// Import a tournament data file:  npm run import -- ../data/tournament.example.json [--category ladies]
// Idempotent: teams are matched by name, players by (team, name), fixtures by number — all within
// the category (the file's "category" field, --category, or Men's by default).
import fs from 'node:fs';
import path from 'node:path';
import { connectDb, disconnectDb } from '../src/db.js';
import * as models from '../src/models/index.js';
import { importTournament } from './lib/importer.js';

const file = process.argv[2];
const ci = process.argv.indexOf('--category');
const category = ci > 0 ? process.argv[ci + 1] : undefined;
if (!file) {
  console.error('usage: npm run import -- <path/to/tournament.json> [--category mens|ladies|kids]');
  process.exit(1);
}

try {
  const data = JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
  await connectDb();
  await Promise.all(Object.values(models).map((M) => M.syncIndexes()));
  console.log(await importTournament(data, { category }));
} catch (err) {
  console.error(`import failed: ${err.message}`);
  process.exitCode = 1;
} finally {
  await disconnectDb();
}
