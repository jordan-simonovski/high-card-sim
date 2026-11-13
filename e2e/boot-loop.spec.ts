import { test } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

// Stress test, not part of the default run: BOOTS=20 npx playwright test boot-loop --project=firefox
test('boot loop', async ({ browser, browserName }) => {
  test.skip(!process.env.BOOTS, 'set BOOTS to run');
  const n = Number(process.env.BOOTS);
  test.setTimeout(n * 40_000);
  const runs: { ok: boolean; ms: number }[] = [];
  for (let i = 0; i < n; i++) {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const t = Date.now();
    await page.goto('/');
    const ok = await page.waitForFunction(() => (window as any).__hc?.boot.state === 'ready', null, { timeout: 30_000 }).then(() => true, () => false);
    runs.push({ ok, ms: Date.now() - t });
    await ctx.close();
  }
  mkdirSync('test-results-boot', { recursive: true });
  writeFileSync(`test-results-boot/${browserName}.json`, JSON.stringify(runs));
  console.log(browserName, `${runs.filter((r) => r.ok).length}/${n} booted`, 'median ms', runs.map((r) => r.ms).sort((a, b) => a - b)[n >> 1]);
});
