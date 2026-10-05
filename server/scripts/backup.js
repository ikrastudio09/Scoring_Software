// Database backup.
//   npm run backup                 → backups/<timestamp>/ via mongodump (gzip, BSON)
//   npm run backup -- --json       → backups/<timestamp>.json via the driver (no tools needed)
// Keeps the newest BACKUP_KEEP (default 30) backups. Restore: see docs/DEPLOYMENT.md.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';
import { config } from '../src/config/env.js';
import { connectDb, disconnectDb } from '../src/db.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const dir = path.resolve(process.env.BACKUP_DIR || path.join(root, 'backups'));
const keep = Number(process.env.BACKUP_KEEP || 30);
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
fs.mkdirSync(dir, { recursive: true });

function prune() {
  const entries = fs.readdirSync(dir).filter((f) => f.startsWith('backup-')).sort();
  for (const old of entries.slice(0, Math.max(entries.length - keep, 0))) {
    fs.rmSync(path.join(dir, old), { recursive: true, force: true });
  }
}

if (!process.argv.includes('--json')) {
  const out = path.join(dir, `backup-${stamp}`);
  const r = spawnSync('mongodump', [`--uri=${config.mongoUri}`, `--out=${out}`, '--gzip'], { stdio: 'inherit' });
  if (r.status === 0) {
    prune();
    console.log(`backup written to ${out}`);
    process.exit(0);
  }
  console.warn('mongodump unavailable or failed; falling back to JSON export');
}

await connectDb();
try {
  const out = path.join(dir, `backup-${stamp}.json`);
  const dump = {};
  for (const { name } of await mongoose.connection.db.listCollections().toArray()) {
    dump[name] = await mongoose.connection.db.collection(name).find().toArray();
  }
  fs.writeFileSync(out, JSON.stringify(dump));
  prune();
  console.log(`backup written to ${out} (${Object.keys(dump).length} collections)`);
} finally {
  await disconnectDb();
}
