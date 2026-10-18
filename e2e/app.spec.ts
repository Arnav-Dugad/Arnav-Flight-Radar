import { expect, test, type Page } from '@playwright/test';

const LONDON = '/?lat=51.47&lon=-0.45&z=8.5';

async function ready(page: Page, url = LONDON) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(url);
  await expect(page.locator('main canvas.maplibregl-canvas')).toBeVisible();
  // Splash disappears once the map has loaded.
  await expect(page.locator('img[src="/brand/arnav-mark-animated.svg"]')).toHaveCount(0, { timeout: 30_000 });
  return errors;
}

/** The simulated world is built and transmitting. */
async function worldReady(page: Page) {
  await expect(page.getByRole('button', { name: /Simulated world\. \d+ aircraft airborne/ })).toBeVisible({ timeout: 30_000 });
}

test.describe('desktop', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) < 768, 'desktop only');

  test('loads the simulated world, clock and attribution', async ({ page }) => {
    const errors = await ready(page);
    await expect(page.getByRole('banner')).toContainText('ARNAV');
    await worldReady(page);
    await expect(page.getByRole('banner')).toContainText('Simulated');
    await expect(page.getByRole('contentinfo')).toContainText('Simulated traffic');
    await expect(page.getByRole('contentinfo')).toContainText('OpenStreetMap');
    await expect(page.getByRole('contentinfo')).not.toContainText('adsb.fi');
    const box = await page.locator('main canvas.maplibregl-canvas').boundingBox();
    expect(box!.height).toBeGreaterThan(600);
    expect(errors).toEqual([]);
  });

  test('API: health, providers and the pinned-airport manifest; no live aircraft endpoints', async ({ request }) => {
    const h = await request.get('/api/health');
    expect(h.ok()).toBe(true);
    const p = await request.get('/api/providers');
    const ids = ((await p.json()).providers as { id: string }[]).map((x) => x.id);
    expect(ids).toContain('simulation');
    expect(ids).not.toContain('adsbfi');
    const live = await request.get('/api/aircraft/nearby?lat=51.47&lon=-0.45&radius=60');
    expect(live.status()).toBe(404);
    const m = await request.get('/api/manifest.webmanifest?pins=EGLL,<script>');
    const manifest = await m.json();
    expect(manifest.shortcuts.map((s: { url: string }) => s.url)).toEqual(['/?apt=EGLL']);
  });

  test('clock controls change the simulation speed', async ({ page }) => {
    await ready(page);
    await worldReady(page);
    await page.getByRole('button', { name: /Simulated world/ }).click();
    const dialog = page.getByRole('dialog', { name: 'Simulation clock' });
    await dialog.getByRole('radio', { name: '15×' }).click();
    await expect(dialog.getByRole('radio', { name: '15×' })).toHaveAttribute('aria-checked', 'true');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('banner')).toContainText('15×');
    await page.keyboard.press('1');
    await expect(page.getByRole('banner')).not.toContainText('15×');
  });

  test('search finds a flight, an airline and an airport', async ({ page }) => {
    await ready(page);
    await worldReady(page);
    await page.keyboard.press('Control+k');
    const input = page.getByRole('combobox');
    await expect(input).toBeFocused();
    await input.fill('British Airways');
    await expect(page.getByRole('option').filter({ hasText: 'British Airways' }).first()).toBeVisible();
    await input.fill('LHR');
    await expect(page.getByRole('option').first()).toContainText('Heathrow');
    await page.keyboard.press('Enter');
    const panel = page.getByRole('complementary', { name: 'Airport details' });
    await expect(panel).toContainText('LHR');
    await panel.getByRole('tab', { name: 'Runways' }).click();
    await expect(panel).toContainText(/09L|27R|09R|27L/);
    await panel.getByRole('tab', { name: 'Weather' }).click();
    await expect(panel).toContainText(/METAR · EGLL/);
  });

  test('airports show boards, the departure queue, runway in use, chart and sun & moon', async ({ page }) => {
    await ready(page);
    await worldReady(page);
    await page.keyboard.press('Control+k');
    await page.getByRole('combobox').fill('LHR');
    await expect(page.getByRole('option').first()).toContainText('Heathrow');
    await page.keyboard.press('Enter');
    const panel = page.getByRole('complementary', { name: 'Airport details' });
    await expect(panel).toContainText('Runway in use');
    await expect(panel).toContainText('Movements per hour');
    await expect(panel).toContainText('Sun & moon');
    await panel.getByRole('tab', { name: 'Departures' }).click();
    await expect(panel).toContainText(/Simulated schedule/);
    await panel.getByRole('tab', { name: 'Ground' }).click();
    await expect(panel).toContainText('Departure queue');
  });

  test('an aircraft opens a full flight card with route, times and 3D view', async ({ page }) => {
    await ready(page);
    await worldReady(page);
    await page.keyboard.press('j');
    const panel = page.getByRole('complementary', { name: 'Aircraft details' });
    await expect(panel).toBeVisible();
    await expect(panel).toContainText('Simulated');
    await expect(panel).toContainText('Departure');
    await expect(panel).toContainText('Arrival');
    await panel.getByRole('tab', { name: 'Aircraft' }).click();
    await expect(panel).toContainText('Aircraft type');
    await panel.getByRole('button', { name: /3D view/ }).click();
    await expect(page.getByRole('status').filter({ hasText: /Following|Paused following/ })).toBeVisible();
    await page.keyboard.press('Escape');
  });

  test('airline page lists its fleet and flights', async ({ page }) => {
    await ready(page);
    await worldReady(page);
    await page.keyboard.press('Control+k');
    await page.getByRole('combobox').fill('Lufthansa');
    await page.getByRole('option').filter({ hasText: /Lufthansa/ }).first().click();
    const panel = page.getByRole('complementary', { name: 'Airline details' });
    await expect(panel).toContainText('Airborne now');
    await panel.getByRole('tab', { name: 'Fleet' }).click();
    await expect(panel).toContainText(/AIRBUS|BOEING/);
  });

  test('map controls: zoom, globe, theme switch, filters, settings', async ({ page }) => {
    await ready(page);
    await page.getByRole('button', { name: 'Zoom in' }).click();
    await page.keyboard.press('g');
    await expect(page.getByRole('button', { name: 'Flat map' }).first()).toBeVisible();
    await page.keyboard.press('g');

    await page.keyboard.press('l');
    const layers = page.getByRole('complementary', { name: 'Map styles and layers' });
    await expect(layers).toBeVisible();
    await layers.getByRole('button', { name: /Arctic Glass/ }).click();
    await expect(page).toHaveURL(/style=arctic/);
    await layers.getByRole('button', { name: /Obsidian Radar/ }).click();

    await page.keyboard.press('f');
    const filters = page.getByRole('complementary', { name: 'Aircraft filters' });
    await expect(filters).toContainText(/aircraft match/);
    await filters.getByRole('radio', { name: 'Airborne' }).click();
    await expect(page.locator('nav[aria-label="Tools"] [aria-label="Filters"]')).toContainText('1');
    await filters.getByRole('button', { name: 'Clear all' }).click();

    await page.keyboard.press(',');
    const settings = page.getByRole('complementary', { name: 'Settings' });
    await settings.getByRole('radio', { name: 'Metres' }).click();
    await expect(settings.getByRole('radio', { name: 'Metres' })).toHaveAttribute('aria-checked', 'true');
    await settings.getByRole('radio', { name: 'Feet' }).click();
  });

  test('pins airports to the map, reorders and unpins them', async ({ page }) => {
    await ready(page);
    await worldReady(page);
    for (const code of ['LHR', 'JFK']) {
      await page.keyboard.press('Control+k');
      await page.getByRole('combobox').fill(code);
      await page.keyboard.press('Enter');
      const panel = page.getByRole('complementary', { name: 'Airport details' });
      await panel.getByRole('button', { name: 'Pin to map' }).click();
      await page.keyboard.press('Escape');
    }
    const lhr = page.getByRole('region', { name: 'Pinned airport LHR' });
    const jfk = page.getByRole('region', { name: 'Pinned airport JFK' });
    await expect(lhr).toBeVisible();
    await expect(jfk).toBeVisible();
    await jfk.getByRole('button', { name: 'Move JFK up' }).click();
    const first = page.getByRole('region', { name: /Pinned airport/ }).first();
    await expect(first).toHaveAccessibleName('Pinned airport JFK');
    await lhr.getByRole('button', { name: 'Unpin airport' }).click();
    await jfk.getByRole('button', { name: 'Unpin airport' }).click();
    await expect(page.getByRole('region', { name: /Pinned airport/ })).toHaveCount(0);
  });

  test('widgets show busiest airports and notable flights', async ({ page }) => {
    await ready(page);
    await worldReady(page);
    await page.keyboard.press('w');
    const panel = page.getByRole('complementary', { name: 'World activity widgets' });
    await expect(panel).toContainText('Busiest airports');
    await expect(panel).toContainText('Longest flights in the air');
  });

  test('keyboard cycling selects aircraft and announces them', async ({ page }) => {
    await ready(page);
    await worldReady(page);
    const live = page.locator('[aria-live="polite"].sr-only');
    await page.keyboard.press(']');
    await expect(live).toContainText(/Selected .+|No aircraft in view/);
  });

  test('vertical profile and range rings toggle from the keyboard', async ({ page }) => {
    await ready(page);
    await page.keyboard.press('v');
    const profile = page.getByRole('region', { name: 'Vertical profile of aircraft in view' });
    await expect(profile).toBeVisible();
    await page.keyboard.press('v');
    await expect(profile).toHaveCount(0);
    await page.keyboard.press('r');
    await page.keyboard.press('l');
    await expect(page.getByRole('switch', { name: 'Range rings' })).toHaveAttribute('aria-checked', 'true');
    await page.keyboard.press('r');
  });

  test('analytics labels its sample as simulated', async ({ page }) => {
    await ready(page);
    await worldReady(page);
    await page.keyboard.press('a');
    const panel = page.getByRole('complementary', { name: 'Traffic analytics' });
    await expect(panel).toContainText(/Sample: [\d,]+ simulated aircraft/);
  });
});

for (const width of [1280, 1440, 1920]) {
  test(`desktop layout at ${width}px has no overflow`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await ready(page);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(overflow).toBe(false);
    const header = await page.getByRole('banner').boundingBox();
    const footer = await page.getByRole('contentinfo').boundingBox();
    expect(header!.y + header!.height).toBeLessThan(footer!.y);
  });
}
