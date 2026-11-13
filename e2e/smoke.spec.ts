import { test, expect, type Page } from '@playwright/test';

type Hc = { boot: { state: string; replayed: number; attempt: number }; query: (sql: string, p?: object) => Promise<any[]>; log: { all(): Promise<unknown[]> } };
const hc = (page: Page) => page.evaluate.bind(page);
const waitReady = (page: Page) =>
  page.waitForFunction(() => ['ready', 'failed'].includes((window as any).__hc?.boot.state), null, { timeout: 120_000 });
const say = (page: Page, text: RegExp) => expect(page.locator('#text')).toHaveText(text, { timeout: 120_000 });

test('boots, plays the prologue on SQL, survives reload via the event log', async ({ page }) => {
  await page.goto('/');

  // Prologue renders before the engine is up.
  await say(page, /03:12/);
  const stateAtFirstLine = await hc(page)(() => (window as any).__hc.boot.state);

  for (const line of [/03:12/, /CRITICAL/, /dashboard/]) {
    await say(page, line);
    await expect(page.locator('#box.waiting')).toBeVisible();
    await page.keyboard.press('Enter');
  }
  await page.locator('[data-choice="ack"]').click(); // instantly: avg hesitation < 3 s
  for (const line of [/through the glass/, /ingested/, /high cardinality/]) {
    await say(page, line);
    await expect(page.locator('#box.waiting')).toBeVisible();
    await page.keyboard.press('Enter');
  }
  // `listening` branches on content/queries/hesitated.sql, so this line proves SQL-driven flow.
  await say(page, /acked fast/);

  await waitReady(page);
  const boot = await hc(page)(() => (window as any).__hc.boot as Hc['boot']);
  expect(boot.state).toBe('ready');

  const counts = await hc(page)(async () => {
    const h = (window as any).__hc as Hc;
    const [r] = await h.query('SELECT count() AS c FROM events');
    return { chdb: Number(r.c), idb: (await h.log.all()).length };
  });
  expect(counts.chdb).toBe(counts.idb);
  expect(counts.idb).toBeGreaterThanOrEqual(10);

  // Player strings go through params, never concatenation.
  const nasty = ["x'; DROP TABLE events; --\\", 'two\nlines\tand a tab', '\\N', "''", 'they/them 🏳️‍⚧️', '{v:String}'];
  const echoed = await hc(page)(
    async (vs) => Promise.all(vs.map(async (v) => (await (window as any).__hc.query('SELECT {v:String} AS v', { v }))[0].v)),
    nasty,
  );
  expect(echoed).toEqual(nasty);

  // Reload: chDB starts empty, the IndexedDB log is replayed into it.
  await page.reload();
  await waitReady(page);
  expect(await hc(page)(() => (window as any).__hc.boot)).toMatchObject({ state: 'ready' });
  const after = await hc(page)(async (n) => {
    const h = (window as any).__hc as Hc;
    const [r] = await h.query('SELECT count() AS c FROM events WHERE seq < {n:UInt64}', { n });
    return { replayed: h.boot.replayed, kept: Number(r.c) };
  }, counts.idb);
  expect(after.replayed).toBeGreaterThanOrEqual(counts.idb);
  expect(after.kept).toBe(counts.idb);

  test.info().annotations.push(
    { type: 'state at first line', description: stateAtFirstLine },
    { type: 'boot attempts', description: String(boot.attempt) },
  );
});
