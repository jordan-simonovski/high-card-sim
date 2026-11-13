import { test, expect, type Page } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('hc.textSpeed', 'instant'));
  if (process.env.SHARE_URL) await page.goto(process.env.SHARE_URL);
});

/** Boot, seed a small session through the real event log (mirrored into chDB), open the shell. */
async function openSeededShell(page: Page) {
  await page.goto('/');
  await page.waitForFunction(() => (window as any).__hc?.boot.state === 'ready', null, { timeout: 120_000 });
  await page.evaluate(async () => {
    const log = (window as any).__hc.log;
    const pause = () => new Promise((r) => setTimeout(r, 12));
    type E = { scene: string; event_type: string; character?: string; dialogue_text?: string; choice_text?: string; affection_delta?: number; time_to_choose_ms?: number; attributes?: Record<string, string> };
    const evs: E[] = [
      { scene: 'date_logs', event_type: 'scene_enter' },
      { scene: 'date_logs', event_type: 'line', dialogue_text: 'The archive café smells like old paper.' },
      { scene: 'date_logs', event_type: 'line', character: 'logs', dialogue_text: 'I log my coffee orders. All of them.' },
      { scene: 'date_logs', event_type: 'line', character: 'logs', dialogue_text: 'Every timestamp, every barista.' },
      { scene: 'date_logs', event_type: 'choice', character: 'logs', choice_text: 'Tell me more about the coffee', dialogue_text: 'Tell me more about the coffee', affection_delta: 1, time_to_choose_ms: 1200 },
      { scene: 'date_logs', event_type: 'line', character: 'logs', dialogue_text: 'The coffee was cold. I wrote that down.' },
      { scene: 'date_metrics', event_type: 'scene_enter' },
      { scene: 'date_metrics', event_type: 'line', character: 'metrics', dialogue_text: 'Reps. Sets. Totals.' },
      { scene: 'date_metrics', event_type: 'choice', character: 'metrics', choice_text: 'Spot me?', dialogue_text: 'Spot me?', affection_delta: 2, time_to_choose_ms: 800 },
      { scene: 'date_metrics', event_type: 'line', character: 'metrics', dialogue_text: 'Counter incremented.' },
      { scene: 'date_metrics', event_type: 'choice', character: 'metrics', choice_text: 'What was my name again?', dialogue_text: 'What was my name again?', affection_delta: -1, time_to_choose_ms: 4100 },
      { scene: 'date_traces', event_type: 'scene_enter' },
      { scene: 'date_traces', event_type: 'line', character: 'traces', dialogue_text: 'Oh! You are in my sample.' },
      { scene: 'date_traces', event_type: 'choice', character: 'traces', choice_text: 'Mark this moment important', dialogue_text: 'Mark this moment important', affection_delta: 1, time_to_choose_ms: 3000, attributes: { 'sampling.priority': '1' } },
      { scene: 'date_traces', event_type: 'line', character: 'traces', dialogue_text: 'Kept.' },
    ];
    for (const e of evs) {
      await log.append(e);
      await pause();
    }
    void (window as any).__hc.openShell();
  });
  await expect(page.locator('#console')).toBeVisible();
  await expect(page.locator('#tab-sql')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#sql')).toBeVisible();
}

const noSidewaysScroll = (page: Page) =>
  page.evaluate(() => {
    const d = document.querySelector('#console')!;
    return d.scrollWidth <= d.clientWidth;
  });

test('shell views: logs filter, trace waterfall and sources, metrics charts, exemplar opens the trace', async ({ page }) => {
  await openSeededShell(page);

  // Tabs are a real tablist: arrow keys move and select.
  await page.locator('#tab-sql').focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#tab-logs')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#tab-logs')).toBeFocused();
  await expect(page.locator('#panel-logs')).toBeVisible();
  await expect(page.locator('#panel-sql')).toBeHidden();

  // Logs: search narrows and highlights, chips filter by character, order flips.
  const items = page.locator('#logs-list li');
  await expect(page.locator('#logs-count')).toHaveText(/^(\d+) of \1 lines$/);
  const all = await items.count();
  expect(all).toBeGreaterThanOrEqual(12);
  await page.locator('#logs-search').fill('COFFEE');
  await expect(items).toHaveCount(3);
  await expect(page.locator('#logs-list mark').first()).toHaveText(/coffee/i);
  await page.locator('#logs-search').fill('');
  await page.locator('.viz-chip', { hasText: 'Metrics' }).click();
  await expect(items).toHaveCount(4);
  await expect(page.locator('#logs-list .who').first()).toHaveText('Metrics');
  const first = await page.locator('#logs-list .line').first().textContent();
  await page.locator('#logs-order').click();
  await expect(page.locator('#logs-order')).toHaveText(/oldest first/);
  expect(await page.locator('#logs-list .line').first().textContent()).not.toBe(first);
  await page.locator('#logs-search').fill('zzz no such line');
  await expect(page.locator('#logs-list .viz-empty')).toContainText('Nothing Logs heard matches');

  // Trace: the sample first, then everything.
  await page.locator('#tab-trace').click();
  await expect(page.locator('#trace-summary')).toContainText(/Traces (only saw \d+ of \d+|saw none of your \d+) moments/);
  const sampled = await page.locator('#panel-trace .wf-row.moment').count();
  expect(sampled).toBeGreaterThanOrEqual(1); // the moment marked important is always kept
  await page.locator('#panel-trace .viz-seg', { hasText: 'events (everything)' }).click();
  await expect(page.locator('#trace-summary')).toContainText('Every moment');
  const everything = page.locator('#panel-trace .wf-row.moment');
  await expect(everything).toHaveCount(12);
  expect(sampled).toBeLessThan(12);
  await expect(page.locator('#panel-trace .wf-row.scene')).toHaveCount(3);
  await expect(page.locator('#panel-trace .bar.choice')).toHaveCount(4);
  // Collapse a scene, then open a span's details with the keyboard.
  await page.locator('#panel-trace .wf-row.scene').first().click();
  await expect(page.locator('#panel-trace .wf-row.scene').first()).toHaveAttribute('aria-expanded', 'false');
  await expect(everything.filter({ visible: true })).toHaveCount(7);
  await everything.filter({ visible: true }).first().focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#trace-details')).toBeVisible();
  await expect(page.locator('#trace-details dl')).toContainText('time_to_choose_ms');
  expect(await noSidewaysScroll(page)).toBe(true);

  // Querying events from a view is a genuine base-table query.
  const base = await page.evaluate(async () => {
    const [r] = await (window as any).__hc.query("SELECT count() AS n FROM events WHERE event_type = 'query_run' AND attributes['query.base_table'] = 'true'");
    return Number(r.n);
  });
  expect(base).toBeGreaterThan(0);

  // Metrics: every chart type renders.
  await page.locator('#tab-metrics').click();
  const chart = page.locator('#metrics-chart');
  await expect(chart.locator('svg')).toBeVisible();
  await expect(chart.locator('svg .label')).toContainText(['Metrics']);
  await page.locator('#panel-metrics .viz-seg', { hasText: 'stacked' }).click();
  await expect(chart.locator('.viz-legend')).toBeVisible();
  expect(await chart.locator('svg .label').count()).toBeGreaterThanOrEqual(3); // plus the scene the shell's own queries ran in
  await expect(chart.locator('.viz-legend')).toContainText('Logs');
  await page.locator('#panel-metrics .viz-seg', { hasText: 'stat' }).click();
  await expect(chart.locator('.tile')).toHaveCount(5);
  await expect(chart.locator('.tile', { hasText: 'Choices' })).toContainText('4');
  await page.locator('#panel-metrics .viz-seg', { hasText: 'over time' }).click();
  await expect(page.locator('#panel-metrics .viz-note')).toContainText('metrics_agg only keeps totals');
  const dots = chart.locator('svg .ex');
  await expect(dots).toHaveCount(4);

  // An exemplar: tooltip, then straight to its span in the full trace.
  await dots.nth(1).click();
  const tip = chart.locator('.viz-tip');
  await expect(tip).toBeVisible();
  await expect(tip).toContainText('Spot me?');
  await expect(tip).toContainText('+2 affection');
  await tip.getByRole('button', { name: /open in trace/ }).click();
  await expect(page.locator('#tab-trace')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#panel-trace .viz-seg[aria-pressed="true"]')).toHaveText('events (everything)');
  const current = page.locator('#panel-trace .wf-row.moment[aria-current]');
  await expect(current).toHaveCount(1);
  await expect(current).toContainText('Spot me?');
  await expect(current).toBeFocused();
  await expect(page.locator('#trace-details')).toContainText('Spot me?');

  // Closing and reopening the shell lands on SQL again (the playthrough types there).
  await page.locator('#console .close').click();
  await page.evaluate(() => void (window as any).__hc.openShell());
  await expect(page.locator('#tab-sql')).toHaveAttribute('aria-selected', 'true');
});

test('shell views fit a 390px phone: no sideways dialog scroll, tooltips stay on screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openSeededShell(page);
  for (const tab of ['logs', 'trace', 'metrics']) {
    await page.locator(`#tab-${tab}`).click();
    await expect(page.locator(`#panel-${tab} .viz-status`)).toContainText('rows');
    expect(await noSidewaysScroll(page), tab).toBe(true);
  }
  await page.locator('#panel-metrics .viz-seg', { hasText: 'over time' }).click();
  const dots = page.locator('#metrics-chart svg .ex');
  await expect(dots).toHaveCount(4);
  for (const i of [0, 3]) {
    await dots.nth(i).click();
    const box = (await page.locator('#metrics-chart .viz-tip').boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    const svg = (await page.locator('#metrics-chart svg').first().boundingBox())!;
    await page.mouse.click(svg.x + 2, svg.y + svg.height - 2); // tap away: the pinned tooltip lets go
    await expect(page.locator('#metrics-chart .viz-tip')).toBeHidden();
  }
  expect(await noSidewaysScroll(page)).toBe(true);
  // The waterfall scrolls sideways inside its own box instead.
  await page.locator('#tab-trace').click();
  await page.locator('#panel-trace .viz-seg', { hasText: 'events (everything)' }).click();
  await expect(page.locator('#trace-summary')).toContainText('Every moment');
  const inner = await page.locator('#panel-trace .wf-scroll').evaluate((el) => el.scrollWidth > el.clientWidth);
  expect(inner).toBe(true);
  expect(await noSidewaysScroll(page)).toBe(true);
});

test('the incident: clues in every view, the kept trace, and the same incident after a reload', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => (window as any).__hc?.boot.state === 'ready', null, { timeout: 120_000 });
  await page.evaluate(() => (window as any).__hc.incident('incident_start', 'incident', 'alarm'));

  // The case file: Sev-1 open, Logs is the current lead, and its tab is marked.
  await page.evaluate(() => (window as any).__hc.openShell('logs'));
  await expect(page.locator('#casefile')).toBeVisible();
  await expect(page.locator('#casefile li.current')).toContainText('Logs: read everything');
  await expect(page.locator('#tab-logs')).toHaveClass(/lead/);
  await expect(page.locator('#tab-logs')).toHaveAttribute('aria-selected', 'true');

  // Logs: the WARN she kept writing, found by filtering to WARN and grouping into patterns.
  await page.locator('#logs-levels .viz-seg', { hasText: 'WARN' }).click();
  await page.locator('#logs-patterns').click();
  const top = page.locator('#logs-list.patterns li').first();
  await expect(top).toContainText('WARN metrics: cardinality limit exceeded, dropping series {attribute=subscriber_id}');
  await expect(top.locator('.n')).toHaveText(/^×\d{2,}$/);
  await page.locator('#logs-search').fill('cardinality limit');
  await expect(page.locator('#logs-count')).toContainText('1 of 4 patterns');

  // Metrics: an incident opens on errors per minute, one series until tier is back…
  await page.locator('#tab-metrics').click();
  await expect(page.locator('#panel-metrics .viz-seg[aria-pressed=true]')).toHaveText('errors');
  await expect(page.locator('#metrics-chart svg')).toHaveAttribute('aria-label', /^Errors per minute, from events.*Totals: all errors \d+\.$/);
  // …then Metrics adds it back, and the same chart splits with onlyspans carrying it.
  await page.locator('#console .close').click();
  await page.evaluate(() => (window as any).__hc.log.append({ scene: 'phase_metrics', node: 'add', event_type: 'line' }));
  await page.evaluate(() => (window as any).__hc.openShell('metrics'));
  await expect(page.locator('#metrics-chart svg')).toHaveAttribute('aria-label', /^Errors per minute by tier.*Totals: onlyspans \d{2,}, /);

  // Traces: nothing kept yet; keep it, and the whole path shows, dying in the batch processor.
  await page.locator('#tab-trace').click();
  await expect(page.locator('#trace-realm')).not.toContainText('kept');
  await page.evaluate(() => (window as any).__hc.incident('keep_trace', 'phase_traces', 'keep'));
  await page.locator('#tab-metrics').click();
  await page.locator('#tab-trace').click();
  const kept = page.locator('#trace-realm .realm-trace').first();
  await expect(kept).toContainText('the-one-that-never-finishes');
  await expect(kept).toContainText('kept (sampling.priority = 1)');
  await expect(kept.locator('li.error')).toContainText('collector.batch_processor');
  const before = await page.evaluate(() => (window as any).__hc.query("SELECT count() AS n, sum(cityHash64(event_id)) AS h FROM events WHERE scene = 'incident'"));

  // Reload: the log replays and the markers regenerate the same Realm telemetry.
  await page.reload();
  await page.waitForFunction(() => (window as any).__hc?.boot.state === 'ready', null, { timeout: 120_000 });
  const after = await page.evaluate(() => (window as any).__hc.query("SELECT count() AS n, sum(cityHash64(event_id)) AS h FROM events WHERE scene = 'incident'"));
  expect(after).toEqual(before);
});
