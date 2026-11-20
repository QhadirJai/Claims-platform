import { expect, test } from '@playwright/test';
import path from 'node:path';
import { USERS, statusBadge, userPage } from './helpers';

/**
 * Claimant activity reaches the assigned officer through Kafka → worker → notification,
 * and shows up in the staff inbox with an unread badge in the sidebar.
 */
test('officer is notified in the inbox when the claimant adds photos', async ({ browser }) => {
  const alice = await userPage(browser, USERS.alice);
  await alice.getByRole('link', { name: 'Report an incident' }).click();
  await alice.getByLabel('Policy number').fill(`POL-E2E-I-${Date.now()}`);
  await alice.getByLabel('Location').fill('Tampines Ave 5');
  await alice.getByLabel('What happened?').fill('Rear windscreen cracked by a falling branch.');
  await alice.getByLabel('Estimated amount claimed').fill('750');
  await alice.getByRole('button', { name: 'Submit claim' }).click();
  await expect(statusBadge(alice)).toHaveText('Submitted');
  const claimNumber = (await alice.locator('.page-head h2').innerText()).trim();

  const olivia = await userPage(browser, USERS.olivia);
  await olivia.goto('/staff');
  await olivia.getByRole('row').filter({ hasText: claimNumber }).getByRole('button', { name: 'Pick up' }).click();
  await expect(statusBadge(olivia)).toHaveText('Under review');

  await alice.reload();
  await alice.getByLabel('Add more photos').setInputFiles(path.join(__dirname, 'fixtures', 'damage-front.png'));
  await alice.getByRole('button', { name: 'Upload 1 photo' }).click();
  await expect(alice.locator('.gallery button.thumb')).toHaveCount(1);

  // Written asynchronously by the worker: reload the inbox until it arrives.
  await olivia.goto('/staff/inbox');
  const row = olivia.locator('.inbox-row').filter({ hasText: `New photos on ${claimNumber}` });
  await expect(async () => {
    await olivia.reload();
    await expect(row).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 20_000 });

  await expect(row).toHaveClass(/unread/);
  await expect(olivia.getByRole('link', { name: /Inbox, \d+ unread/ })).toBeVisible();

  // Opening it goes to the claim and marks it read.
  await row.click();
  await expect(olivia).toHaveURL(/\/staff\/claims\//);
  await expect(olivia.locator('.page-head h2')).toHaveText(claimNumber);
  await olivia.getByRole('link', { name: /Inbox/ }).click();
  await expect(olivia.locator('.inbox-row').filter({ hasText: `New photos on ${claimNumber}` })).not.toHaveClass(/unread/);

  await olivia.getByRole('button', { name: 'Mark all as read' }).click();
  await expect(olivia.locator('.inbox-row.unread')).toHaveCount(0);
  await expect(olivia.getByRole('link', { name: 'Inbox', exact: true })).toBeVisible();

  await alice.context().close();
  await olivia.context().close();
});

test('claimants have no staff inbox', async ({ browser }) => {
  const alice = await userPage(browser, USERS.alice);
  await expect(alice.getByRole('link', { name: /Inbox/ })).toHaveCount(0);
  await alice.goto('/staff/inbox');
  await expect(alice).toHaveURL(/\/claimant$/);
  await alice.context().close();
});
