import { Page, expect, test } from '@playwright/test';
import { USERS, statusBadge, userPage } from './helpers';

/**
 * The core journey across both portals, three users, and the Kafka worker:
 * claimant reports → officer picks up, sets reserve, requests info → claimant responds
 * → officer approves and settles → claimant sees the outcome and the async notification.
 */
test.describe.serial('Claim lifecycle across claimant and staff portals', () => {
  let alice: Page;
  let olivia: Page;
  let claimNumber = '';
  let claimUrlStaff = '';
  const policy = `POL-E2E-${Date.now()}`;

  test.beforeAll(async ({ browser }) => {
    alice = await userPage(browser, USERS.alice);
    olivia = await userPage(browser, USERS.olivia);
  });

  test.afterAll(async () => {
    await alice.context().close();
    await olivia.context().close();
  });

  test('claimant reports an incident', async () => {
    await alice.getByRole('link', { name: 'Report an incident' }).click();
    await expect(alice.getByRole('heading', { name: 'Report an incident' })).toBeVisible();

    const submit = alice.getByRole('button', { name: 'Submit claim' });
    await expect(submit).toBeDisabled(); // form invalid until filled

    await alice.getByLabel('Claim type').selectOption('Motor');
    await alice.getByLabel('Market').selectOption('SG');
    await alice.getByLabel('Policy number').fill(policy);
    await alice.getByLabel('Location').fill('Bukit Timah Road');
    await alice.getByLabel('What happened?').fill('Side door dented by a reversing van in a car park.');
    await alice.getByLabel('Estimated amount claimed').fill('1500');
    await submit.click();

    await expect(alice).toHaveURL(/\/claimant\/claims\/[0-9a-f-]{36}$/);
    await expect(statusBadge(alice)).toHaveText('Submitted');
    claimNumber = (await alice.locator('.page-head h2').innerText()).trim();
    expect(claimNumber).toMatch(/^CLM-\d{8}-\d{6}$/);
  });

  test('officer finds it in the unassigned queue and picks it up', async () => {
    await olivia.goto('/staff');
    const row = olivia.getByRole('row').filter({ hasText: claimNumber });
    await expect(row).toBeVisible();
    await row.getByRole('button', { name: 'Pick up' }).click();

    await expect(olivia).toHaveURL(/\/staff\/claims\//);
    await expect(statusBadge(olivia)).toHaveText('Under review');
    await expect(olivia.locator('.facts')).toContainText('Olivia Lim');
    claimUrlStaff = olivia.url();
  });

  test('officer sets a reserve and requests more information', async () => {
    await olivia.getByLabel('Reserve', { exact: true }).fill('1200');
    await olivia.getByRole('button', { name: 'Set reserve' }).click();
    await expect(olivia.locator('.facts')).toContainText('1,200.00');

    await olivia.getByLabel('Request information').fill('Please upload photos of the damaged door.');
    await olivia.getByRole('button', { name: 'Send request' }).click();
    await expect(statusBadge(olivia)).toHaveText('Info requested');
    await expect(olivia.getByText('Awaiting claimant…')).toBeVisible();
  });

  test('claimant sees the request, responds, and never sees the reserve', async () => {
    await alice.goto('/claimant');
    const card = alice.locator('.claim-card').filter({ hasText: claimNumber });
    await expect(card).toContainText('Action needed');
    await card.click();

    await expect(alice.getByText('We need more information')).toBeVisible();
    await expect(alice.locator('p').filter({ hasText: 'Please upload photos of the damaged door.' })).toBeVisible();

    // Reserve is the insurer's internal estimate — must not leak to the claimant UI.
    await expect(alice.locator('main')).not.toContainText('Reserve');
    await expect(alice.locator('main')).not.toContainText('1,200');

    await alice.getByPlaceholder('Your response').fill('Uploaded 4 photos via email, ref IMG-2231.');
    await alice.getByRole('button', { name: 'Send response' }).click();
    await expect(statusBadge(alice)).toHaveText('Under review');
    await expect(alice.getByText('We need more information')).toHaveCount(0);
  });

  test('officer sees the response, approves and settles', async () => {
    await olivia.goto(claimUrlStaff);
    await expect(olivia.getByText('Uploaded 4 photos via email, ref IMG-2231.')).toBeVisible();

    await olivia.getByLabel('Approve amount').fill('1400');
    await olivia.getByRole('button', { name: 'Approve', exact: true }).click();
    await expect(statusBadge(olivia)).toHaveText('Approved');

    await olivia.getByRole('button', { name: 'Mark as settled' }).click();
    await expect(statusBadge(olivia)).toHaveText('Settled');
    await expect(olivia.getByText('This claim is closed.')).toBeVisible();
  });

  test('claimant sees the outcome and the Kafka-driven notification', async () => {
    await alice.goto('/claimant');
    const card = alice.locator('.claim-card').filter({ hasText: claimNumber });
    await expect(card.locator('app-status')).toHaveText('Settled');
    await expect(card).toContainText('Approved 1,400');

    // Notifications are written asynchronously by Claims.Worker — poll until it catches up.
    await expect(async () => {
      await alice.reload();
      await expect(alice.locator('.notification').filter({ hasText: `${claimNumber} has been settled` }))
        .toBeVisible({ timeout: 1_000 });
    }).toPass({ timeout: 20_000 });

    await alice.locator('.claim-card').filter({ hasText: claimNumber }).click();
    const timeline = alice.locator('.timeline');
    for (const step of ['Claim submitted', 'Picked up for review', 'Information requested',
                        'Information provided', 'Approved', 'Settled']) {
      await expect(timeline).toContainText(step);
    }
    await expect(timeline).not.toContainText('Reserve updated');
  });
});

test('officer rejects a claim and the claimant sees the reason', async ({ browser }) => {
  const ben = await userPage(browser, USERS.ben);
  await ben.getByRole('link', { name: 'Report an incident' }).click();
  await ben.getByLabel('Claim type').selectOption('Property');
  await ben.getByLabel('Market').selectOption('MY');
  await ben.getByLabel('Policy number').fill(`POL-E2E-R-${Date.now()}`);
  await ben.getByLabel('Location').fill('Petaling Jaya');
  await ben.getByLabel('What happened?').fill('Gradual ceiling leak stained the living room wall.');
  await ben.getByLabel('Estimated amount claimed').fill('2600');
  await ben.getByRole('button', { name: 'Submit claim' }).click();
  await expect(statusBadge(ben)).toHaveText('Submitted');
  const claimNumber = (await ben.locator('.page-head h2').innerText()).trim();

  const oscar = await userPage(browser, USERS.oscar);
  await oscar.getByRole('row').filter({ hasText: claimNumber }).getByRole('button', { name: 'Pick up' }).click();
  await expect(statusBadge(oscar)).toHaveText('Under review');
  await oscar.getByLabel('Rejection reason').fill('Gradual damage and wear and tear are excluded.');
  await oscar.getByRole('button', { name: 'Reject' }).click();
  await expect(statusBadge(oscar)).toHaveText('Rejected');

  await ben.reload();
  await expect(statusBadge(ben)).toHaveText('Rejected');
  await expect(ben.locator('.card').filter({ hasText: 'Decision: not approved.' })).toContainText('Gradual damage and wear and tear are excluded.');

  await ben.context().close();
  await oscar.context().close();
});

test('another officer cannot act on a claim they do not own', async ({ browser }) => {
  // Seeded claim c4 (SG Property fire) is assigned to Olivia.
  const oscar = await userPage(browser, USERS.oscar);
  await oscar.getByRole('button', { name: 'All claims' }).click();
  await oscar.getByRole('row').filter({ hasText: 'Olivia Lim' }).filter({ hasText: 'Under review' })
    .first().getByRole('link').click();
  await expect(oscar.getByText('Only they or a manager can act.')).toBeVisible();
  await expect(oscar.getByRole('button', { name: 'Approve', exact: true })).toHaveCount(0);
  await oscar.context().close();
});
