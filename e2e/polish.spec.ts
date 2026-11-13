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
