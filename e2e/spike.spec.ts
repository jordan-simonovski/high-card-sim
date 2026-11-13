import { test, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

// Total RSS (MB) of Playwright-launched browser processes. Rough: shared pages double count.
const browserRssMB = () =>
  Math.round(
    execSync('ps -axo rss=,command=').toString().split('\n')
      .filter((l) => l.includes('ms-playwright') && !l.includes('ps -axo'))
      .reduce((a, l) => a + Number(l.trim().split(/\s+/)[0] || 0), 0) / 1024,
  );

mkdirSync('spike-results', { recursive: true });

// Protected Vercel deployments: visit a _vercel_share link first to get the auth cookie.
test.beforeEach(async ({ page }) => {
  if (process.env.SHARE_URL) await page.goto(process.env.SHARE_URL);
});

async function run(page: Page, url: string) {
  await page.goto(url);
  await page.waitForFunction(() => (window as any).__spike?.done, null, { timeout: 280_000 });
  return page.evaluate(() => (window as any).__spike);
}

for (const threads of ['mt', 'st'] as const) {
  test(`spike ${threads}`, async ({ page, browserName }) => {
    await page.goto('about:blank');
    const rssBaseline = browserRssMB();
    const cold = await run(page, `/?threads=${threads}`);
    const rssAfterSpike = browserRssMB();
    const warm = await run(page, `/?threads=${threads}`); // same context: HTTP cache warm
    const persist = await run(page, `/?probe=persist`);
    const result = { rssBaseline, rssAfterSpike, cold, warmColdStart: warm.coldStart, tablesAfterReload: persist.tablesAtBoot };
    writeFileSync(`spike-results/${browserName}-${threads}.json`, JSON.stringify(result, null, 2));
  });
}
