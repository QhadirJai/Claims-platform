import { Page, expect, test } from '@playwright/test';
import path from 'node:path';
import { USERS, login, statusBadge, userPage } from './helpers';

const fixture = (name: string) => path.join(__dirname, 'fixtures', name);

/** Every thumbnail has finished loading a real image (fetched with the bearer token). */
async function expectThumbnailsLoaded(page: Page, count: number) {
  const imgs = page.locator('.gallery button.thumb img');
  await expect(imgs).toHaveCount(count);
  for (const img of await imgs.all()) {
    await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true);
  }
}

test.describe.serial('Photo evidence', () => {
  let claimUrl = '';
  let claimNumber = '';

  test('claimant reports an incident with photos', async ({ page }) => {
    await login(page, USERS.alice);
    await page.getByRole('link', { name: 'Report an incident' }).click();

    await page.getByLabel('Policy number').fill(`POL-E2E-P-${Date.now()}`);
    await page.getByLabel('Location').fill('Jalan Ampang');
    await page.getByLabel('What happened?').fill('Front bumper and side panel scraped against a bollard.');
    await page.getByLabel('Estimated amount claimed').fill('900');

    await page.getByLabel('Add photos of the damage').setInputFiles([fixture('damage-front.png'), fixture('damage-side.png')]);
    await expect(page.locator('.thumb.picked')).toHaveCount(2);

    // Remove one and add it back: previews are local, nothing is uploaded until submit.
    await page.getByRole('button', { name: 'Remove damage-side.jpg' }).click();
    await expect(page.locator('.thumb.picked')).toHaveCount(1);
    await page.getByText('Add more photos').locator('..').locator('input[type=file]').setInputFiles(fixture('damage-side.png'));
    await expect(page.locator('.thumb.picked')).toHaveCount(2);

    await page.getByRole('button', { name: 'Submit claim' }).click();
    await expect(page).toHaveURL(/\/claimant\/claims\//);
    await expect(statusBadge(page)).toHaveText('Submitted');
    await expectThumbnailsLoaded(page, 2);
    await expect(page.locator('.timeline')).toContainText('2 photos added');

    claimUrl = page.url();
    claimNumber = (await page.locator('.page-head h2').innerText()).trim();
  });

  test('a file that is not an image is refused in the browser', async ({ page }) => {
    await login(page, USERS.alice);
    await page.goto(claimUrl);
    await page.getByLabel('Add more photos').setInputFiles(fixture('not-a-photo.jpg'));
    await expect(page.getByText('could not be read. Use a JPEG or PNG photo.')).toBeVisible();
    await expect(page.locator('.thumb.picked')).toHaveCount(0);
  });

  test('the API refuses a disguised file even if the browser check is bypassed', async ({ page }) => {
    await login(page, USERS.alice);
    const token = await page.evaluate(() => JSON.parse(sessionStorage.getItem('claimshub.session')!).token);
    const claimId = claimUrl.split('/').pop();
    const res = await page.request.post(`http://localhost:5080/api/claims/${claimId}/attachments`, {
      headers: { Authorization: `Bearer ${token}` },
      multipart: { files: { name: 'evil.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('<script>alert(1)</script>') } }
    });
    expect(res.status()).toBe(400);
    expect((await res.json()).detail).toContain('Only JPEG and PNG photos are accepted');
  });

  test('officer sees the photos and can view them full size', async ({ browser }) => {
    const olivia = await userPage(browser, USERS.olivia);
    await olivia.getByRole('row').filter({ hasText: claimNumber }).getByRole('link').click();
    await expect(olivia.locator('.section-title').filter({ hasText: 'Photo evidence' })).toContainText('2');
    await expectThumbnailsLoaded(olivia, 2);

    await olivia.locator('.gallery button.thumb').first().click();
    const viewer = olivia.getByRole('dialog', { name: 'Photo viewer' });
    await expect(viewer).toContainText('1 of 2');
    await olivia.keyboard.press('ArrowRight');
    await expect(viewer).toContainText('2 of 2');
    await olivia.keyboard.press('Escape');
    await expect(viewer).toHaveCount(0);
    await olivia.context().close();
  });

  test('another claimant cannot fetch the photos', async ({ browser }) => {
    const claimId = claimUrl.split('/').pop();
    const alice = await userPage(browser, USERS.alice);
    const aliceToken = await alice.evaluate(() => JSON.parse(sessionStorage.getItem('claimshub.session')!).token);
    const claim = await (await alice.request.get(`http://localhost:5080/api/claims/${claimId}`,
      { headers: { Authorization: `Bearer ${aliceToken}` } })).json();
    const photoUrl = `http://localhost:5080/api/claims/${claimId}/attachments/${claim.attachments[0].id}`;
    const own = await alice.request.get(photoUrl, { headers: { Authorization: `Bearer ${aliceToken}` } });
    expect(own.status()).toBe(200);
    expect(own.headers()['content-type']).toBe('image/jpeg');
    await alice.context().close();

    const ben = await userPage(browser, USERS.ben);
    const token = await ben.evaluate(() => JSON.parse(sessionStorage.getItem('claimshub.session')!).token);
    const res = await ben.request.get(photoUrl, { headers: { Authorization: `Bearer ${token}` } });
    expect(res.status()).toBe(404); // not 403: do not reveal that the claim exists
    await ben.context().close();
  });
});

test.describe('Session', () => {
  test('Back after signing in does not return to the login form', async ({ page }) => {
    await login(page, USERS.alice);
    await page.goBack();
    await expect(page).not.toHaveURL(/\/login$/);
    await page.goto('/login');
    await expect(page).toHaveURL(/\/claimant$/);
  });

  test('after signing out, Back does not reopen the portal', async ({ page }) => {
    await login(page, USERS.olivia);
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/login$/);
    await page.goBack();
    await expect(page).not.toHaveURL(/\/staff/);
    // Typing a portal address directly also lands on the login form.
    await page.goto('/staff');
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
  });
});
