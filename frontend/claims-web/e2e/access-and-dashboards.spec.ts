import { expect, test } from '@playwright/test';
import { PASSWORD, USERS, login } from './helpers';

test.describe('Authentication', () => {
  test('wrong password shows an error and stays on login', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill(USERS.alice);
    await page.getByLabel('Password').fill('wrong-password');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByText('Invalid email or password.')).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);
  });

  test('unauthenticated users are sent to login', async ({ page }) => {
    await page.goto('/staff/dashboard');
    await expect(page).toHaveURL(/\/login$/);
  });

  test('each role lands on its own portal', async ({ page }) => {
    await login(page, USERS.alice);
    await expect(page).toHaveURL(/\/claimant$/);
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/login$/);

    await page.getByLabel('Email').fill(USERS.olivia);
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/staff$/);
    await expect(page.getByRole('heading', { name: 'Claims queue' })).toBeVisible();
  });
});

test.describe('Role-based access (UI guards)', () => {
  test('claimant cannot open staff pages', async ({ page }) => {
    await login(page, USERS.alice);
    await page.goto('/staff');
    await expect(page).toHaveURL(/\/claimant$/);
    await expect(page.getByRole('link', { name: 'Dashboard' })).toHaveCount(0);
  });

  test('staff cannot open claimant pages', async ({ page }) => {
    await login(page, USERS.olivia);
    await page.goto('/claimant');
    await expect(page).toHaveURL(/\/staff$/);
  });

  test('claimant only sees their own claims', async ({ page }) => {
    await login(page, USERS.alice);
    const cards = page.locator('.claim-card');
    await expect(cards.first()).toBeVisible();
    // Seed: Ben's claims are in MY / HK / TH; Alice has none of Ben's policy numbers.
    await expect(page.locator('main')).not.toContainText('Ben Wong');
  });
});

test.describe('Staff queue & dashboards', () => {
  test('queue filters work', async ({ page }) => {
    await login(page, USERS.olivia);
    await page.getByRole('button', { name: 'All claims' }).click();
    await page.locator('.filters select').nth(2).selectOption('HK');
    await expect(page.locator('.table-wrap.loading')).toHaveCount(0);
    const rows = page.locator('tbody tr');
    await expect(rows.first()).toBeVisible();
    for (const row of await rows.all()) await expect(row).toContainText('HK');
  });

  test('officer sees workload but not liability exposure', async ({ page }) => {
    await login(page, USERS.olivia);
    await page.getByRole('link', { name: 'Dashboard' }).click();
    await expect(page.getByRole('heading', { name: 'Workload by officer' })).toBeVisible();
    await expect(page.getByRole('row').filter({ hasText: 'Olivia Lim' })).toBeVisible();
    await expect(page.getByText('Liability exposure is visible to managers.')).toBeVisible();
    await expect(page.getByRole('heading', { name: /Liability exposure by market/ })).toHaveCount(0);
  });

  test('manager sees exposure and it adds up', async ({ page }) => {
    await login(page, USERS.maya);
    await page.getByRole('link', { name: 'Dashboard' }).click();
    await expect(page.getByRole('heading', { name: /Liability exposure by market/ })).toBeVisible();

    const parse = (s: string) => Number(s.replace(/[^0-9.]/g, ''));
    const exposureTable = page.locator('table').nth(1);
    const totals = await exposureTable.locator('tbody tr td:last-child strong').allInnerTexts();
    const footer = parse(await exposureTable.locator('tfoot td:last-child').innerText());
    expect(totals.length).toBeGreaterThan(0);
    expect(totals.map(parse).reduce((a, b) => a + b, 0)).toBe(footer);
  });
});
