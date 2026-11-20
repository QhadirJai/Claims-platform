import { Browser, Page, expect } from '@playwright/test';

export const PASSWORD = 'Passw0rd!';

export const USERS = {
  alice: 'alice@demo.local',
  ben: 'ben@demo.local',
  olivia: 'olivia@demo.local',
  oscar: 'oscar@demo.local',
  maya: 'maya@demo.local'
} as const;

export async function login(page: Page, email: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/(claimant|staff)/);
}

/** Each user gets an isolated browser context (separate session storage). */
export async function userPage(browser: Browser, email: string): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await login(page, email);
  return page;
}

export const statusBadge = (page: Page) => page.locator('.page-head app-status');
