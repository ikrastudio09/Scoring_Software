// Create an admin or scorer account:
//   npm run create-user -- <username> <role: admin|scorer>     (password read from CRICKET_PASSWORD or prompted)
import readline from 'node:readline/promises';
import { connectDb, disconnectDb } from '../src/db.js';
import { createUser } from '../src/services/auth.js';

const [username, role = 'scorer'] = process.argv.slice(2);
if (!username || !['admin', 'scorer'].includes(role)) {
  console.error('usage: npm run create-user -- <username> <admin|scorer>');
  process.exit(1);
}
let password = process.env.CRICKET_PASSWORD;
if (!password) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  password = await rl.question('Password (min 10 chars): ');
  rl.close();
}
if (!password || password.length < 10) {
  console.error('Password must be at least 10 characters');
  process.exit(1);
}
await connectDb();
try {
  console.log('created', await createUser({ username, password, role }));
} catch (err) {
  console.error(err.message);
  process.exitCode = 1;
} finally {
  await disconnectDb();
}
