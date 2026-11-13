import { test, expect, type Page } from '@playwright/test';

type Hc = { boot: { state: string; replayed: number }; query: (sql: string, p?: object) => Promise<any[]>; log: { all(): Promise<unknown[]> } };
const hc = (page: Page) => page.evaluate.bind(page);
const waitReady = (page: Page) =>
  page.waitForFunction(() => ['ready', 'failed'].includes((window as any).__hc?.boot.state), null, { timeout: 120_000 });
const say = (page: Page, text: RegExp) => expect(page.locator('#text')).toHaveText(text, { timeout: 120_000 });
const next = async (page: Page, line: RegExp) => {
  await say(page, line);
  await expect(page.locator('#box.waiting')).toBeVisible();
  await page.keyboard.press('Enter');
};

// Protected Vercel deployments: visit a _vercel_share link first to get the auth cookie.
test.beforeEach(async ({ page }) => {
  // Tests read hundreds of lines: skip the typewriter.
  await page.addInitScript(() => localStorage.setItem('hc.textSpeed', 'instant'));
  if (process.env.SHARE_URL) await page.goto(process.env.SHARE_URL);
});

// Hostile on purpose: quotes, backslash, a template token, emoji. Must render literally.
const NAME = `Ada "{they}" O'Brien\\`;

test('prologue, character creation, SQL branch, reload replays the event log', async ({ page }) => {
  await page.goto('/');
  await page.locator('#btn-new').click();

  // Prologue renders before the engine is up.
  await say(page, /03:12/);
  for (const line of [/03:12/, /CRITICAL/, /dashboard/]) await next(page, line);
  await page.locator('[data-choice="ack"]').click(); // instantly: avg hesitation < 3 s
  for (const line of [/through the glass/, /ingested/, /high cardinality/, /span attributes/]) await next(page, line);

  // Character creation: a free-text name (the player has no pronouns; they're always "you").
  const form = page.locator('#create');
  await expect(form).toBeVisible();
  await form.locator('button[type=submit]').click();
  await expect(page.locator('#create-error')).toContainText('player.name is required');
  await form.locator('[name=name]').fill(NAME);
  await expect(page.locator('#preview')).toContainText(NAME);
  await expect(page.locator('#create [name=gender], #create [name=pronouns]')).toHaveCount(0);
  await form.locator('button[type=submit]').click();
  await expect(form).toBeHidden();

  // {name} renders from state, literally, however hostile it is.
  await next(page, new RegExp(`player\\.name = "${NAME.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`));
  await next(page, new RegExp(`EVERYONE! ${NAME.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} is here!`));
  // `listening` branches on content/queries/hesitated.sql, so this proves SQL-driven flow.
  await say(page, /acked fast/);

  await waitReady(page);
  expect(await hc(page)(() => (window as any).__hc.boot.state)).toBe('ready');

  const counts = await hc(page)(async () => {
    const h = (window as any).__hc as Hc;
    const [r] = await h.query('SELECT count() AS c FROM events');
    const [p] = await h.query(
      "SELECT attributes['player.name'] AS name, mapContains(attributes, 'player.gender') OR mapContains(attributes, 'player.pronouns') AS has_pronouns FROM events WHERE event_type = 'character_created'",
    );
    return { chdb: Number(r.c), idb: (await h.log.all()).length, player: p };
  });
  expect(counts.chdb).toBe(counts.idb);
  expect(counts.player).toEqual({ name: NAME, has_pronouns: 0 });

  // Player strings go through params, never concatenation.
  const nasty = ["x'; DROP TABLE events; --\\", 'two\nlines\tand a tab', '\\N', "''", 'they/them 🏳️‍⚧️', '{v:String}'];
  const echoed = await hc(page)(
    async (vs) => Promise.all(vs.map(async (v) => (await (window as any).__hc.query('SELECT {v:String} AS v', { v }))[0].v)),
    nasty,
  );
  expect(echoed).toEqual(nasty);

  // Reload: chDB starts empty, the IndexedDB log is replayed, the player is restored
  // from it, and character creation is not asked again.
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

  // Continue resumes from the event log: no prologue replay, no second character creation.
  await page.locator('#btn-continue').click();
  await expect(page.locator('#create')).toBeHidden();
  await expect(page.locator('#text')).not.toHaveText(/03:12/);
});
