// Visual regression tests (run with VISUAL=1 npx playwright test --project visual).
// The aircraft feed is MOCKED with a small synthetic fixture so screenshots are
// deterministic. These test fixtures are never used by the app itself.
import { expect, test, type Page } from '@playwright/test';

const FIXTURE = [
  { id: 'fff001', cs: 'TST101', t: 'A20N', d: 'AIRBUS A-320neo', lat: 51.52, lon: -0.62, alt: 9000, gs: 290, trk: 85, vr: 1500 },
  { id: 'fff002', cs: 'TST202', t: 'B789', d: 'BOEING 787-9', lat: 51.38, lon: -0.2, alt: 36000, gs: 480, trk: 300, vr: 0 },
  { id: 'fff003', cs: 'TST303', t: 'AT76', d: 'ATR 72-600', lat: 51.62, lon: -0.1, alt: 15000, gs: 260, trk: 180, vr: -900 },
  { id: 'fff004', cs: 'TST404', t: 'C68A', d: 'CESSNA 680A', lat: 51.3, lon: -0.75, alt: 41000, gs: 450, trk: 45, vr: 0 },
  { id: 'fff005', cs: 'TST505', t: 'EC45', d: 'EUROCOPTER EC-145', lat: 51.5, lon: -0.35, alt: 1500, gs: 110, trk: 120, vr: 0 },
];

async function mockApi(page: Page) {
  await page.route('**/api/aircraft/nearby**', async (route) => {
    const now = Date.now();
    await route.fulfill({
      json: {
        provider: 'adsbfi',
        attribution: { name: 'adsb.fi', url: 'https://adsb.fi', license: 'test fixture' },
        query: { lat: 51.5, lon: -0.45, radiusNm: 100 },
        providerNow: now,
        fetchedAt: now,
        servedAt: now,
        stale: false,
        cache: { hit: false, ageMs: 0, ttlMs: 10000 },
        count: FIXTURE.length,
        aircraft: FIXTURE.map((f) => ({
          id: f.id,
          icao24: f.id,
          callsign: f.cs,
          aircraftType: f.t,
          typeDescription: f.d,
          lat: f.lat,
          lon: f.lon,
          altitudeBarometric: f.alt,
          groundSpeed: f.gs,
          track: f.trk,
          verticalRate: f.vr,
          onGround: false,
          positionSource: 'adsb',
          observedAt: now - 2000,
          seenAt: now - 500,
          receivedAt: now,
          provider: 'adsbfi',
          freshness: 'live',
        })),
      },
    });
  });
  await page.route('https://api.planespotters.net/**', (route) => route.fulfill({ json: { photos: [] } }));
}

async function open(page: Page, url: string) {
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'dark' });
  await mockApi(page);
  await page.goto(url);
  await expect(page.locator('main canvas.maplibregl-canvas')).toBeVisible();
  await expect(page.locator('img[src="/brand/arnav-mark-animated.svg"]')).toHaveCount(0, { timeout: 30_000 });
  await page.waitForLoadState('networkidle').catch(() => undefined);
  await page.waitForTimeout(2500);
}

const dynamic = (page: Page) => [page.getByRole('contentinfo'), page.locator('header button').filter({ hasText: /aircraft/ }), page.getByText(/Live · \d/)];

test.describe('visual', () => {
  test('radar (obsidian)', async ({ page }) => {
    await open(page, '/?lat=51.47&lon=-0.45&z=8.6&style=obsidian');
    await expect(page).toHaveScreenshot('radar-obsidian.png', { mask: dynamic(page), maxDiffPixelRatio: 0.04 });
  });

  test('radar (arctic, light glass)', async ({ page }) => {
    await open(page, '/?lat=51.47&lon=-0.45&z=8.6&style=arctic');
    await expect(page).toHaveScreenshot('radar-arctic.png', { mask: dynamic(page), maxDiffPixelRatio: 0.04 });
  });

  test('aircraft panel', async ({ page }) => {
    await open(page, '/?lat=51.47&lon=-0.45&z=8.6&style=obsidian&ac=fff002');
    await expect(page.getByRole('complementary', { name: 'Aircraft details' })).toContainText('TST202');
    await page.waitForTimeout(1500);
    await expect(page).toHaveScreenshot('aircraft-panel.png', { mask: dynamic(page), maxDiffPixelRatio: 0.04 });
  });

  test('analytics panel', async ({ page }) => {
    await open(page, '/?lat=51.47&lon=-0.45&z=8.6&style=obsidian');
    await page.keyboard.press('a');
    await page.waitForTimeout(1500);
    await expect(page.getByRole('complementary', { name: 'Traffic analytics' })).toHaveScreenshot('analytics-panel.png', { maxDiffPixelRatio: 0.03 });
  });

  test('mobile radar', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page, '/?lat=51.47&lon=-0.45&z=8&style=obsidian');
    await expect(page).toHaveScreenshot('mobile-radar.png', { mask: dynamic(page), maxDiffPixelRatio: 0.04 });
  });
});
