import { test, expect } from '@playwright/test';

// Simulates a browser without Memory64 (real iOS Safari 27 reports this). The in-world
// unsupported screen shows and the engine is never requested.
test('unsupported client screen', async ({ page }) => {
  await page.addInitScript(() => {
    WebAssembly.validate = () => false;
  });
  const engine: string[] = [];
  page.on('request', (r) => r.url().includes('/chdb/') && engine.push(r.url()));
  await page.goto('/');
  await expect(page.locator('#unsupported')).toBeVisible();
  await expect(page.locator('#unsupported .why')).toContainText('Memory64');
  expect(engine).toEqual([]);
});

test.describe('firefox', () => {
  test.use({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 15.0; rv:140.0) Gecko/20100101 Firefox/140.0' });
  test('firefox gets the unsupported screen in v1', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#unsupported .why')).toContainText('Firefox');
  });
});
