import { expect, test } from '@playwright/test';
import { USERS, login, statusBadge } from './helpers';

// Claimants often report from their phone at the scene — the claimant portal must work on mobile.
test('claimant can report an incident on a phone', async ({ page }) => {
  await login(page, USERS.alice);

  const noHorizontalScroll = async () =>
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  await noHorizontalScroll();
  await page.getByRole('link', { name: 'Report an incident' }).click();
  await noHorizontalScroll();

  await page.getByLabel('Policy number').fill(`POL-E2E-M-${Date.now()}`);
  await page.getByLabel('Location').fill('Orchard Road');
  await page.getByLabel('What happened?').fill('Mirror knocked off by a passing motorcycle.');
  await page.getByLabel('Estimated amount claimed').fill('350');
  await page.getByRole('button', { name: 'Submit claim' }).click();

  await expect(statusBadge(page)).toHaveText('Submitted');
  await noHorizontalScroll();
});
