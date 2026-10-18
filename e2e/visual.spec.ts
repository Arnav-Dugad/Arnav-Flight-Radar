// Visual regression tests (run with VISUAL=1 npx playwright test --project visual).
// The simulation is seeded from the date and driven by Date.now(), so the clock is
// frozen at a fixed instant and weather requests are blocked: every run builds the
// same world in the same state.
import { expect, test, type Page } from '@playwright/test';

const FROZEN = new Date('2026-06-15T12:00:00Z');

async function open(page: Page, url: string) {
  await page.clock.setFixedTime(FROZEN);
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'dark' });
  await page.route('**/api/weather/**', (route) => route.abort());
  await page.route('https://api.rainviewer.com/**', (route) => route.abort());
  await page.goto(url);
  await expect(page.locator('main canvas.maplibregl-canvas')).toBeVisible();
  await expect(page.locator('img[src="/brand/arnav-mark-animated.svg"]')).toHaveCount(0, { timeout: 30_000 });
  await expect(page.getByRole('button', { name: /Simulated world\. \d+ aircraft airborne/ })).toBeVisible({ timeout: 30_000 });
  await page.waitForLoadState('networkidle').catch(() => undefined);
  // The worker adds helicopter, glider and other extra traffic shortly after start-up.
  await page.waitForTimeout(6000);
}

const dynamic = (page: Page) => [page.getByRole('contentinfo'), page.getByRole('button', { name: /Simulated world/ })];

test.describe('visual', () => {
  test('radar (obsidian)', async ({ page }) => {
    await open(page, '/?lat=51.47&lon=-0.45&z=8.6&style=obsidian');
    await expect(page).toHaveScreenshot('radar-obsidian.png', { mask: dynamic(page), maxDiffPixelRatio: 0.05 });
  });

  test('radar (arctic, light glass)', async ({ page }) => {
    await open(page, '/?lat=51.47&lon=-0.45&z=8.6&style=arctic');
    await expect(page).toHaveScreenshot('radar-arctic.png', { mask: dynamic(page), maxDiffPixelRatio: 0.05 });
  });

  test('aircraft panel', async ({ page }) => {
    await open(page, '/?lat=51.47&lon=-0.45&z=8.6&style=obsidian');
    await page.keyboard.press(']');
    const panel = page.getByRole('complementary', { name: 'Aircraft details' });
    await expect(panel).toContainText('Simulated');
    await page.waitForTimeout(2000);
    await expect(page).toHaveScreenshot('aircraft-panel.png', { mask: [...dynamic(page), panel.locator('img')], maxDiffPixelRatio: 0.05 });
  });

  test('analytics panel', async ({ page }) => {
    await open(page, '/?lat=51.47&lon=-0.45&z=8.6&style=obsidian');
    await page.keyboard.press('a');
    await page.waitForTimeout(1500);
    await expect(page.getByRole('complementary', { name: 'Traffic analytics' })).toHaveScreenshot('analytics-panel.png', { maxDiffPixelRatio: 0.04 });
  });

  test('mobile radar', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page, '/?lat=51.47&lon=-0.45&z=8&style=obsidian');
    await expect(page).toHaveScreenshot('mobile-radar.png', { mask: dynamic(page), maxDiffPixelRatio: 0.05 });
  });
});
