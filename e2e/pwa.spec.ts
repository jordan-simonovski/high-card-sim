import { test, expect } from '@playwright/test';

test('installable, and plays offline once the engine has been cached', async ({ page, context, browserName }) => {
  test.skip(browserName !== 'chromium', 'service worker check runs once');
  test.setTimeout(180_000);
  const ready = () => page.waitForFunction(() => (window as any).__hc?.boot.state === 'ready', null, { timeout: 90_000 });

  await page.goto('/');
  const manifest = await page.evaluate(async () => (await fetch('/manifest.webmanifest')).json());
  expect(manifest.icons.map((i: { sizes: string }) => i.sizes)).toEqual(expect.arrayContaining(['192x192', '512x512']));
  await ready();
  await page.evaluate(() => navigator.serviceWorker.ready);

  await page.reload(); // now controlled: the engine and art are fetched through the worker and cached
  await ready();
  expect(await page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);

  await context.setOffline(true);
  await page.reload();
  await ready();
  await expect(page.locator('#btn-new')).toBeVisible();
  await context.setOffline(false);
});
