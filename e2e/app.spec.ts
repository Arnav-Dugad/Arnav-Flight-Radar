import { expect, test, type Page } from '@playwright/test';

const LONDON = '/?lat=51.47&lon=-0.45&z=8.5';

async function ready(page: Page, url = LONDON) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(url);
  await expect(page.locator('canvas.maplibregl-canvas')).toBeVisible();
  // Splash disappears once the map has loaded.
  await expect(page.locator('img[src="/brand/arnav-mark-animated.svg"]')).toHaveCount(0, { timeout: 30_000 });
  return errors;
}

test.describe('desktop', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) < 768, 'desktop only');

  test('loads the radar, live status and attribution', async ({ page }) => {
    const errors = await ready(page);
    await expect(page.getByRole('banner')).toContainText('ARNAV');
    const status = page.getByRole('button', { name: /aircraft in the queried area/i }).first();
    await expect(status).toBeVisible();
    await expect(page.getByRole('contentinfo')).toContainText('adsb.fi');
    await expect(page.getByRole('contentinfo')).toContainText('OpenStreetMap');
    const box = await page.locator('canvas.maplibregl-canvas').boundingBox();
    expect(box!.height).toBeGreaterThan(600);
    expect(errors).toEqual([]);
  });

  test('API health and config respond', async ({ request }) => {
    const h = await request.get('/api/health');
    expect(h.ok()).toBe(true);
    expect((await h.json()).status).toBe('ok');
    const c = await request.get('/api/config');
    expect((await c.json()).aircraft.maxRadiusNm).toBe(250);
    const bad = await request.get('/api/aircraft/nearby?lat=999&lon=0');
    expect(bad.status()).toBe(400);
  });

  test('live data query returns normalized aircraft', async ({ request }) => {
    const r = await request.get('/api/aircraft/nearby?lat=51.47&lon=-0.45&radius=60');
    expect([200, 503]).toContain(r.status()); // 503 only if the provider is unavailable
    if (r.ok()) {
      const j = await r.json();
      expect(j.provider).toBe('adsbfi');
      expect(j.query.radiusNm).toBeLessThanOrEqual(250);
      for (const a of j.aircraft.slice(0, 20)) {
        expect(typeof a.lat).toBe('number');
        expect(a.observedAt).toBeLessThanOrEqual(j.fetchedAt + 5000);
      }
    }
  });

  test('search finds an airport and opens its panel', async ({ page }) => {
    await ready(page);
    await page.keyboard.press('Control+k');
    const input = page.getByRole('combobox');
    await expect(input).toBeFocused();
    await input.fill('LHR');
    await expect(page.getByRole('option').first()).toContainText('Heathrow');
    await page.keyboard.press('Enter');
    const panel = page.getByRole('complementary', { name: 'Airport details' });
    await expect(panel).toContainText('LHR');
    await panel.getByRole('tab', { name: /Runways/ }).click();
    await expect(panel).toContainText(/09L|27R|09R|27L/);
    await panel.getByRole('tab', { name: 'Weather' }).click();
    await expect(panel).toContainText(/METAR · EGLL/);
  });

  test('selects a live aircraft via deep link and shows telemetry', async ({ page, request }) => {
    const r = await request.get('/api/aircraft/nearby?lat=51.47&lon=-0.45&radius=60');
    test.skip(!r.ok(), 'provider unavailable');
    const list = (await r.json()).aircraft as { icao24: string; onGround: boolean }[];
    const target = list.find((a) => !a.onGround) ?? list[0];
    test.skip(!target, 'no aircraft in area right now');
    await ready(page, `${LONDON}&ac=${target!.icao24}`);
    const panel = page.getByRole('complementary', { name: 'Aircraft details' });
    await expect(panel).toBeVisible();
    await expect(panel).toContainText('Altitude');
    await expect(panel).toContainText(target!.icao24.toUpperCase());
    await panel.getByRole('tab', { name: 'Position' }).click();
    await expect(panel).toContainText('Latitude');
    // Follow mode toggles.
    await panel.getByRole('button', { name: /^Follow$/ }).click();
    await expect(page.getByRole('status').filter({ hasText: /Following|Paused following/ })).toBeVisible();
    await page.keyboard.press('Escape');
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
    await expect(filters).toContainText(/observed aircraft match/);
    await filters.getByRole('radio', { name: 'Airborne' }).click();
    await expect(page.locator('nav[aria-label="Tools"] [aria-label="Filters"]')).toContainText('1');
    await filters.getByRole('button', { name: 'Clear all' }).click();

    await page.keyboard.press(',');
    const settings = page.getByRole('complementary', { name: 'Settings' });
    await settings.getByRole('radio', { name: 'Metres' }).click();
    await expect(settings.getByRole('radio', { name: 'Metres' })).toHaveAttribute('aria-checked', 'true');
    await settings.getByRole('radio', { name: 'Feet' }).click();
  });

  test('analytics labels its sample honestly', async ({ page }) => {
    await ready(page);
    await page.keyboard.press('a');
    const panel = page.getByRole('complementary', { name: 'Traffic analytics' });
    await expect(panel).toContainText('never a worldwide total');
    await expect(panel).toContainText(/Sample: \d+ aircraft/);
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
