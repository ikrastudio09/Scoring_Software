// Recompute all derived statistics from the authoritative event log.
import { connectDb, disconnectDb } from '../src/db.js';
import { rebuildAllStats } from '../src/services/stats.js';

await connectDb();
try {
  console.log(await rebuildAllStats());
} finally {
  await disconnectDb();
}
