// The Android app runs the viewer bundle from its own origin (https://localhost in the WebView)
// and calls the API cross-origin at VITE_API_URL. This reproduces that setup in Chrome: the
// android-mode build is served from a separate static origin and must load data and receive
// realtime updates from the API server.
import { execSync } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';

const root = path.resolve(import.meta.dirname, '../..');
const outDir = path.join(root, 'apps/viewer/dist-android-e2e');
const PORT = 4174;
let server;

test.beforeAll(() => {
  execSync(`npx vite build --mode android --outDir ${outDir} --emptyOutDir`, {
    cwd: path.join(root, 'apps/viewer'),
    env: { ...process.env, VITE_API_URL: 'http://127.0.0.1:4100' },
    stdio: 'ignore',
  });
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.webmanifest': 'application/json' };
  server = http.createServer((req, res) => {
    let file = path.join(outDir, decodeURIComponent(req.url.split('?')[0]));
    if (!file.startsWith(outDir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(outDir, 'index.html');
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  }).listen(PORT);
});

test.afterAll(() => {
  server?.close();
  fs.rmSync(outDir, { recursive: true, force: true });
});

test('app bundle loads cross-origin and receives realtime updates', async ({ browser, request }) => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`http://localhost:${PORT}/`);
  await expect(page.getByRole('heading', { name: 'Premier Cricket League' })).toBeVisible();
  await page.getByRole('link', { name: 'Table', exact: true }).click();
  await expect(page.locator('tbody tr')).toHaveCount(13);

  // A live match (5) scored through the API must reach the app over the cross-origin socket.
  const { matches } = await (await request.get('/api/matches')).json();
  const m = matches.find((x) => x.number === 5);
  const { token } = await (await request.post('/api/auth/login', { data: { username: 'admin', password: 'e2e-admin-password' } })).json();
  const H = { Authorization: `Bearer ${token}` };
  const squad = async (id) => (await (await request.get(`/api/teams/${id}`)).json()).team.squad.map((p) => p.id);
  const [a, b] = [await squad(m.teamA.id), await squad(m.teamB.id)];
  await request.post(`/api/matches/${m.id}/setup`, { headers: H, data: { toss: { winner: m.teamA.id, decision: 'bat' }, playingXI: { teamA: a.slice(0, 11), teamB: b.slice(0, 11) } } });
  let v = 0;
  let n = 0;
  const cmd = async (p, data) => {
    const res = await request.post(`/api/matches/${m.id}/${p}`, { headers: H, data: { clientEventId: `app-${Date.now()}-${n++}`, expectedVersion: v, ...data } });
    const body = await res.json();
    expect(res.ok(), JSON.stringify(body)).toBe(true);
    v = body.version;
  };
  await cmd('innings/start', { strikerId: a[0], nonStrikerId: a[1], bowlerId: b[10] });

  await page.goto(`http://localhost:${PORT}/matches/${m.id}`);
  await expect(page.getByTestId('live-score')).toHaveText('0/0');
  await cmd('deliveries', { runs: 4, boundary: true });
  await cmd('deliveries', { runs: 0, wicket: { type: 'bowled' } }); // wicket → pushed to viewers
  await expect(page.getByTestId('live-score')).toHaveText('4/1');

  // Network drop and recovery inside the "app"
  await page.context().setOffline(true);
  await cmd('batter', { batterId: a[2] });
  await cmd('deliveries', { runs: 6, boundary: true });
  await page.context().setOffline(false);
  await expect(page.getByTestId('live-score')).toHaveText('10/1', { timeout: 20000 });
  expect(errors).toEqual([]);

  // Only one match may be live: close this one (as an operator would) so later specs can start theirs.
  await cmd('conclude', { resultType: 'no_result' });
  expect((await request.post(`/api/matches/${m.id}/confirm-result`, { headers: H, data: {} })).ok()).toBe(true);
});
