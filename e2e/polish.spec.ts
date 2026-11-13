import { test, expect } from '@playwright/test';

test('typewriter finishes on click without skipping the line; backlog shows what was said', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('hc.textSpeed', 'slow'));
  await page.goto('/');
  await page.locator('#btn-new').click();

  const text = page.locator('#text');
  await expect(text).not.toHaveText('');
  const partial = (await text.textContent()) ?? '';
  expect(partial.length).toBeLessThan('03:12. Your phone lights up the ceiling.'.length); // still typing

  await page.locator('#box').press('Enter'); // finishes the line…
  await expect(text).toHaveText(/03:12\. Your phone lights up the ceiling\./);
  await expect(page.locator('#box.waiting')).toBeVisible(); // …and waits, instead of skipping it
  await expect(page.locator('#sr-line')).toHaveText(/03:12/); // screen readers get the whole line

  await page.locator('#box').press('Enter');
  await expect(text).not.toHaveText(/03:12/);
  await page.keyboard.press('l');
  await expect(page.locator('#backlog')).toBeVisible();
  await expect(page.locator('#backlog-list li').first()).toBeVisible();
});

test('Escape opens the menu during play', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('hc.textSpeed', 'instant'));
  await page.goto('/');
  await page.locator('#btn-new').click();
  await expect(page.locator('#box.waiting')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#menu')).toBeVisible();
  await expect(page.locator('#text-size')).toBeVisible();
});

test('the speaker name tag is never clipped by the dialogue box', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('hc.textSpeed', 'instant'));
  await page.goto('/');
  await page.locator('#btn-new').click();
  await expect(page.locator('#box.waiting')).toBeVisible();
  await page.keyboard.press('Enter'); // line one is narration; the pager speaks on line two
  await expect(page.locator('#speaker')).toBeVisible();
  const clipped = await page.evaluate(() => {
    const tag = document.querySelector('#speaker')!.getBoundingClientRect();
    const box = document.querySelector('#box')!;
    const style = getComputedStyle(box);
    return { overflow: style.overflowY, aboveBox: tag.top < box.getBoundingClientRect().top };
  });
  expect(clipped).toEqual({ overflow: 'visible', aboveBox: true });
});

test('tapping through the story does not select text', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('hc.textSpeed', 'instant'));
  await page.goto('/');
  await page.locator('#btn-new').click();
  await expect(page.locator('#box.waiting')).toBeVisible();
  await page.locator('#text').dblclick();
  expect(await page.evaluate(() => getSelection()?.toString() ?? '')).toBe('');
});
