import { test } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

// Boot the engine N times (fresh page each time) and record hangs + console output.
test('boot loop', async ({ browser, browserName }) => {
  const n = Number(process.env.BOOTS ?? 8);
  test.setTimeout(n * (Number(process.env.HANG_MS ?? 60_000) + 15_000));
  mkdirSync('spike-results', { recursive: true });
  const out = `spike-results/boot-loop-${browserName}.json`;
  const runs: unknown[] = [];
  for (let i = 0; i < n; i++) {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const log: string[] = [];
    page.on('console', (m) => log.push(`${m.type()}: ${m.text()}`.slice(0, 300)));
    page.on('pageerror', (e) => log.push(`pageerror: ${e.message}`.slice(0, 300)));
    const t = Date.now();
    await page.goto(`/?probe=${process.env.PROBE ?? 'persist'}`);
    const ok = await page
      .waitForFunction(() => (window as any).__spike?.done, null, { timeout: Number(process.env.HANG_MS ?? 60_000) })
      .then(() => true, () => false);
    const state = await page.evaluate(() => (window as any).__spike);
    runs.push({ i, ok, ms: Date.now() - t, fatal: state?.fatal, stage: state?.stage, log: log.slice(-15) });
    writeFileSync(out, JSON.stringify(runs, null, 2));
    await ctx.close();
  }
});
