import { test } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

// Stress test, not part of the default run: boot the game N times (fresh context each)
// and record watchdog retries. BOOTS=20 npx playwright test boot-loop --project=firefox
test('boot loop', async ({ browser, browserName }) => {
  const n = Number(process.env.BOOTS ?? 8);
  test.setTimeout(n * (Number(process.env.HANG_MS ?? 60_000) + 15_000));
  mkdirSync('spike-results', { recursive: true });
  const out = `spike-results/boot-loop-${browserName}.json`;
  const runs: unknown[] = [];
  // RELOAD=1 reuses one page and reloads it, instead of a fresh context per boot.
  const shared = process.env.RELOAD ? await (await browser.newContext()).newPage() : undefined;
  for (let i = 0; i < n; i++) {
    const ctx = shared ? shared.context() : await browser.newContext();
    const page = shared ?? (await ctx.newPage());
    page.removeAllListeners('console');
    const log: string[] = [];
    page.on('console', (m) => log.push(`${m.type()}: ${m.text()}`.slice(0, 300)));
    page.on('pageerror', (e) => log.push(`pageerror: ${e.message}`.slice(0, 300)));
    const t = Date.now();
    await page.goto('/');
    const ok = await page
      .waitForFunction(() => (window as any).__hc?.boot.state === 'ready', null, { timeout: Number(process.env.HANG_MS ?? 60_000) })
      .then(() => true, () => false);
    const state = await page.evaluate(() => (window as any).__hc?.boot);
    runs.push({ i, ok, ms: Date.now() - t, attempt: state?.attempt, error: state?.error, log: log.slice(-15) });
    writeFileSync(out, JSON.stringify(runs, null, 2));
    if (!shared) await ctx.close();
  }
});
