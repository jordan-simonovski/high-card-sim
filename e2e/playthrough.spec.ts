import { test, expect, type Page } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  // Tests read hundreds of lines: skip the typewriter.
  await page.addInitScript(() => localStorage.setItem('hc.textSpeed', 'instant'));
  if (process.env.SHARE_URL) await page.goto(process.env.SHARE_URL);
});

/**
 * Plays the whole game with a fixed policy. Generic on purpose: it reacts to what is on
 * screen (lines, choices, the creation form, the Query Shell), not to specific text, so the
 * script can change without breaking it. Returns the ending title.
 */
async function playToEnding(page: Page, opts: { queryBaseTable: boolean; prefer: (ids: string[]) => string }) {
  for (let step = 0; step < 800; step++) {
    if (await page.locator('#ending').isVisible()) return (await page.locator('#ending-title').textContent()) ?? '';
    if (await page.locator('#create').isVisible()) {
      await page.fill('[name=name]', 'Kit');
      await page.locator('#create button[type=submit]').click();
      continue;
    }
    if (await page.locator('#console').isVisible()) {
      await page.locator('#tab-sql').click(); // the incident opens the shell on a view
      await page.fill('#sql', opts.queryBaseTable ? 'SELECT event_type, count() AS n FROM events GROUP BY event_type' : 'SELECT count() FROM logs');
      await page.locator('#run').click();
      await expect(page.locator('#console-status')).toContainText('rows');
      await page.locator('#console .close').click();
      continue;
    }
    const choices = page.locator('#choices button');
    if (await choices.count()) {
      const ids = await choices.evaluateAll((bs) => bs.map((b) => (b as HTMLElement).dataset.choice!));
      const secret = await page.locator('#choices button.secret').evaluateAll((bs) => bs.map((b) => (b as HTMLElement).dataset.choice!));
      const id = secret[0] && opts.queryBaseTable ? secret[0] : opts.prefer(ids);
      const before = await page.locator('#text').textContent();
      await page.locator(`#choices button[data-choice="${id}"]`).click();
      await page.waitForFunction((t) => document.querySelector('#text')?.textContent !== t || !document.querySelector('#choices button'), before);
      continue;
    }
    if (await page.locator('#box.waiting').isVisible()) {
      const before = await page.locator('#text').textContent();
      await page.keyboard.press('Enter');
      await page
        .waitForFunction(
          (t) =>
            document.querySelector('#text')?.textContent !== t ||
            !!document.querySelector('#choices button') ||
            !(document.querySelector('#ending') as HTMLElement).hidden ||
            !(document.querySelector('#create') as HTMLElement).hidden ||
            (document.querySelector('#console') as HTMLDialogElement).open,
          before,
          { timeout: 120_000 },
        );
      continue;
    }
    await page.waitForTimeout(100); // waiting on the engine or a query
  }
  throw new Error('no ending after 800 steps');
}

test('true ending: every turning point lands, stop sampling yourself', async ({ page }) => {
  test.setTimeout(300_000);
  await page.goto('/');
  await page.locator('#btn-new').click();
  const ending = await playToEnding(page, { queryBaseTable: true, prefer: (ids) => ids.find((i) => i !== 'relapse') ?? ids[0] });
  expect(ending).toBe('Stop Sampling Yourself');

  const facts = await page.evaluate(async () => {
    const h = (window as any).__hc;
    const q = async (sql: string) => Object.values((await h.query(sql))[0] ?? {})[0];
    return {
      dates: await q("SELECT uniqExact(scene) FROM events WHERE event_type = 'scene_enter' AND scene LIKE 'date_%'"),
      base: await q("SELECT count() FROM events WHERE event_type = 'query_run' AND attributes['query.base_table'] = 'true'"),
      ending: await q("SELECT attributes['ending.title'] FROM events WHERE event_type = 'ending'"),
      // The console is read-only even if the page tries to write through it.
      write: await h.console('SELECT 1').then(() => h.console("INSERT INTO events (scene) VALUES ('x')")).then(() => 'wrote', (e: Error) => e.message),
    };
  });
  expect(Number(facts.dates)).toBe(3);
  expect(Number(facts.base)).toBeGreaterThan(0);
  expect(facts.ending).toBe('Stop Sampling Yourself');
  expect(facts.write).toMatch(/read-only/);
});

test('a careless player never reaches the polycule', async ({ page }) => {
  test.setTimeout(300_000);
  await page.goto('/');
  await page.locator('#btn-new').click();
  // Always the last option: TL;DR, flattery, plain moments.
  const ending = await playToEnding(page, { queryBaseTable: false, prefer: (ids) => ids[ids.length - 1] });
  expect(ending).not.toBe('Stop Sampling Yourself');
  test.info().annotations.push({ type: 'ending', description: ending });
});
