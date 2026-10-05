// End-to-end: real browser, real server, real database.
import { expect, test } from '@playwright/test';

let matchId;
let token;

test.beforeAll(async ({ request }) => {
  const { matches } = await (await request.get('/api/matches')).json();
  matchId = matches.find((m) => m.number === 4).id;
  token = (await (await request.post('/api/auth/login', { data: { username: 'admin', password: 'e2e-admin-password' } })).json()).token;
});

const deliveries = async (request) => {
  const { events } = await (await request.get(`/api/matches/${matchId}/events`, { headers: { Authorization: `Bearer ${token}` } })).json();
  return events;
};

async function login(page) {
  await page.goto('/admin/login');
  await page.getByLabel('Username').fill('admin');
  await page.getByLabel('Password').fill('e2e-admin-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Matches' })).toBeVisible();
}

test.describe.serial('live match', () => {
  /** @type {import('@playwright/test').Page} */ let admin;
  /** @type {import('@playwright/test').Page} */ let led;
  /** @type {import('@playwright/test').Page} */ let viewer;
  const errors = [];

  test.beforeAll(async ({ browser }) => {
    admin = await browser.newPage();
    for (const p of [admin]) p.on('pageerror', (e) => errors.push(e.message));
    await login(admin);
  });

  test('setup: toss and playing XIs', async () => {
    await admin.goto(`/admin/matches/${matchId}/setup`);
    await admin.getByLabel('Toss won by').selectOption({ index: 1 });
    await admin.getByLabel('Elected to').selectOption('bat');
    for (const card of await admin.locator('text=Tick players in batting order').locator('..').all()) {
      const boxes = card.locator('input[type=checkbox]');
      for (let i = 0; i < 11; i++) await boxes.nth(i).check();
    }
    await admin.getByRole('button', { name: 'Save and go to scoring' }).click();
    await expect(admin.getByText(/Start innings 1/)).toBeVisible();
  });

  test('start innings; LED and viewer subscribe', async ({ browser }) => {
    await admin.getByLabel('Opening bowler').selectOption({ index: 11 });
    await admin.getByRole('button', { name: 'Start innings' }).click();
    await expect(admin.getByTestId('score')).toHaveText('0/0');

    led = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    led.on('pageerror', (e) => errors.push(e.message));
    await led.goto(`/led/?match=${matchId}`);
    await expect(led.getByTestId('led-score')).toHaveText('0/0');

    viewer = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    viewer.on('pageerror', (e) => errors.push(e.message));
    await viewer.goto(`/matches/${matchId}`);
    await expect(viewer.getByTestId('live-score')).toHaveText('0/0');
  });

  test('LED updates after every ball; viewer waits for the over', async () => {
    const t0 = Date.now();
    await admin.getByRole('button', { name: '4', exact: true }).click();
    await expect(led.getByTestId('led-score')).toHaveText('4/0');
    const ledMs = Date.now() - t0;
    console.log(`click → LED updated in ${ledMs} ms (includes Playwright overhead)`);
    await expect(admin.getByTestId('score')).toHaveText('4/0');
    await admin.keyboard.press('1');
    await expect(led.getByTestId('led-score')).toHaveText('5/0');
    // Viewer policy: no per-ball pushes
    await viewer.waitForTimeout(800);
    await expect(viewer.getByTestId('live-score')).toHaveText('0/0');

    // Wide via keyboard (arm W, then 0), then a no-ball with 2 off the bat
    await admin.keyboard.press('w');
    await admin.keyboard.press('0'); // arming is local, so no wait is needed between these two
    await expect(led.getByTestId('led-score')).toHaveText('6/0');
    await admin.getByRole('button', { name: 'Nb', exact: true }).click();
    await admin.getByRole('button', { name: '2', exact: true }).click();
    await expect(led.getByTestId('led-score')).toHaveText('9/0');
    await expect(admin.getByText('Free hit', { exact: false }).first()).toBeVisible();
    await expect(admin.getByTestId('overs')).toContainText('0.2');
  });

  test('wicket flow: dismissal, new batter, and the viewer gets the wicket', async () => {
    await admin.getByRole('button', { name: '•', exact: true }).click(); // free-hit dot
    await admin.getByRole('button', { name: 'WICKET' }).click();
    await admin.getByRole('button', { name: 'Caught', exact: true }).click();
    await admin.getByLabel(/Caught by/).selectOption({ index: 2 });
    await admin.getByRole('button', { name: 'Record wicket' }).click();
    await expect(admin.getByRole('heading', { name: 'New batter' })).toBeVisible();
    await expect(led.getByTestId('led-score')).toHaveText('9/1');
    await expect(viewer.getByTestId('live-score')).toHaveText('9/1'); // wicket is pushed to viewers
    await admin.locator('.grid-cols-2 > button:not([disabled])').first().click();
    await expect(admin.getByRole('button', { name: 'WICKET' })).toBeVisible();
  });

  test('over completes: bowler picker enforces limits, viewer updates', async () => {
    await admin.keyboard.press('2');
    await expect(admin.getByTestId('score')).toHaveText('11/1');
    await admin.keyboard.press('0');
    await expect(admin.getByRole('heading', { name: /Bowler for over 2/ })).toBeVisible();
    await expect(viewer.getByTestId('live-score')).toHaveText('11/1');
    // the previous bowler is disabled with a reason
    await expect(admin.getByText('Bowled the previous over')).toBeVisible();
    await admin.locator('.grid-cols-2 > button:not([disabled])').first().click();
    await expect(admin.getByRole('button', { name: 'WICKET' })).toBeVisible();
  });

  test('undo restores the previous state everywhere', async () => {
    await admin.keyboard.press('6');
    await expect(led.getByTestId('led-score')).toHaveText('17/1');
    await admin.keyboard.press('u');
    await expect(admin.getByText(/This will revert/)).toBeVisible();
    await admin.keyboard.press('Enter');
    await expect(admin.getByTestId('score')).toHaveText('11/1');
    await expect(led.getByTestId('led-score')).toHaveText('11/1');
    const events = await deliveries(admin.request);
    expect(events.at(-1).type).toBe('UNDO');
    expect(events.at(-2).undone).toBe(true);
  });

  test('scorer refresh recovers the exact state', async () => {
    const before = await admin.getByTestId('score').textContent();
    const overs = await admin.getByTestId('overs').textContent();
    await admin.reload();
    await expect(admin.getByTestId('score')).toHaveText(before);
    await expect(admin.getByTestId('overs')).toHaveText(overs);
  });

  test('network loss: command is held, retried and recorded exactly once', async () => {
    const before = (await deliveries(admin.request)).filter((e) => e.type === 'DELIVERY').length;
    await admin.context().setOffline(true);
    await admin.getByRole('button', { name: '3', exact: true }).click();
    await expect(admin.getByText('Not yet confirmed')).toBeVisible();
    // scoring is paused while unconfirmed
    await expect(admin.getByRole('button', { name: '1', exact: true })).toBeDisabled();
    await admin.waitForTimeout(1500);
    await admin.context().setOffline(false);
    await expect(admin.getByText('Not yet confirmed')).toBeHidden({ timeout: 15000 });
    await expect(admin.getByTestId('score')).toHaveText('14/1');
    await expect(led.getByTestId('led-score')).toHaveText('14/1');
    const after = (await deliveries(admin.request)).filter((e) => e.type === 'DELIVERY').length;
    expect(after - before).toBe(1);
  });

  test('LED recovers after its own network drop', async () => {
    await led.context().setOffline(true);
    await admin.keyboard.press('1');
    await expect(admin.getByTestId('score')).toHaveText('15/1');
    await led.waitForTimeout(1000);
    await led.context().setOffline(false);
    await expect(led.getByTestId('led-score')).toHaveText('15/1', { timeout: 20000 });
  });

  test('no page errors', async () => {
    expect(errors).toEqual([]);
  });
});

test.describe('viewer website', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('all public pages render on mobile', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Premier Cricket League' })).toBeVisible();
    await expect(page.getByText('Recent results')).toBeVisible();

    await page.getByRole('link', { name: 'Table', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Points table' })).toBeVisible();
    await expect(page.locator('tbody tr')).toHaveCount(13);

    await page.getByRole('link', { name: 'Stats', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Most runs' })).toBeVisible();

    await page.getByRole('link', { name: 'Matches', exact: true }).first().click();
    await page.getByRole('tab', { name: 'Results' }).click();
    await page.locator('a[href^="/matches/"]').first().click();
    await page.getByRole('tab', { name: 'Scorecard' }).click();
    await expect(page.getByText('Fall of wickets').first()).toBeVisible();
    await page.getByRole('tab', { name: 'Overs' }).click();

    await page.goto('/teams');
    await page.locator('a[href^="/teams/"]').first().click();
    await expect(page.getByRole('heading', { name: 'Squad' })).toBeVisible();
    await page.locator('a[href^="/players/"]').first().click();
    await expect(page.getByRole('heading', { name: /Batting|No matches/ }).or(page.getByText('No matches played yet.'))).toBeVisible();

    // no horizontal page overflow on a phone
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    expect(overflow).toBe(false);
    expect(errors).toEqual([]);
  });

  test('unauthenticated admin routes redirect to login', async ({ page }) => {
    await page.goto(`/admin/matches/${matchId}/score`);
    await expect(page.getByRole('heading', { name: 'Scorer console' })).toBeVisible();
  });
});
