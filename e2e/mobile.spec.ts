import { expect, test } from '@playwright/test';

for (const width of [360, 390, 768]) {
  test(`purpose-built mobile layout at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/?lat=51.47&lon=-0.45&z=8');
    await expect(page.locator('canvas.maplibregl-canvas')).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(overflow).toBe(false);
    if (width < 768) {
      const nav = page.getByRole('navigation', { name: 'Primary' });
      await expect(nav).toBeVisible();
      await nav.getByRole('button', { name: 'More' }).click();
      await expect(page.getByRole('dialog', { name: 'More tools' })).toBeVisible();
      await page.getByRole('dialog', { name: 'More tools' }).getByRole('button', { name: 'Layers' }).click();
      await expect(page.getByRole('dialog', { name: 'Map styles and layers' })).toBeVisible();
      // Touch targets are at least 36 px.
      const box = await nav.getByRole('button', { name: 'Radar' }).boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(36);
    }
  });
}

test('mobile search overlay works', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?lat=51.47&lon=-0.45&z=8');
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Search' }).click();
  await page.getByRole('combobox').fill('Bengaluru');
  await expect(page.getByRole('option').first()).toContainText(/BLR|Bengaluru|Kempegowda/);
});
