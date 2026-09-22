import { test, expect } from '@playwright/test';
test.beforeEach(async ({ request }) => {
  const records = await (await request.get('/api/uploads')).json();
  for (const r of records) await request.delete(`/api/uploads/${r.id}`);
});
test('concurrent files, pause across offline, reload identity and verified download', async ({
  page,
  context,
}) => {
  await page.goto('/');
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 20,
    downloadThroughput: 20 * 1024 * 1024,
    uploadThroughput: 1024 * 1024,
  });
  const original = Buffer.alloc(20 * 1024 * 1024, 41);
  await page.getByLabel('Choose files', { exact: true }).setInputFiles([
    { name: 'landscape.raw', mimeType: 'application/octet-stream', buffer: original },
    {
      name: 'notes.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('Two independent transfers.'),
    },
  ]);
  const main = page.getByRole('article', { name: 'landscape.raw', exact: true });
  await expect(main.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
  await expect
    .poll(
      async () => {
        const rs = await (await page.request.get('/api/uploads')).json();
        return rs.find((r: { name: string }) => r.name === 'landscape.raw')?.offset || 0;
      },
      { timeout: 35000 },
    )
    .toBeGreaterThan(0);
  await main.getByRole('button', { name: 'Pause', exact: true }).click();
  await context.setOffline(true);
  await page.waitForTimeout(1000);
  await context.setOffline(false);
  await expect(main.getByRole('button', { name: 'Resume', exact: true })).toBeVisible();
  await expect(main.getByRole('button', { name: 'Pause', exact: true })).toHaveCount(0);
  await page.reload();
  await expect(main.getByRole('button', { name: 'Select original file' })).toBeVisible();
  await main.getByLabel('Reselect landscape.raw').setInputFiles({
    name: 'landscape.raw',
    mimeType: 'application/octet-stream',
    buffer: Buffer.alloc(original.length, 42),
  });
  await expect(main.getByText('Different content.', { exact: false })).toBeVisible();
  await main.getByLabel('Reselect landscape.raw').setInputFiles({
    name: 'landscape.raw',
    mimeType: 'application/octet-stream',
    buffer: original,
  });
  await expect(main.getByRole('button', { name: 'Download & verify' })).toBeVisible({
    timeout: 65000,
  });
  await expect(
    page
      .getByRole('article', { name: 'notes.txt', exact: true })
      .getByRole('button', { name: 'Download & verify' }),
  ).toBeVisible();
  const download = page.waitForEvent('download');
  await main.getByRole('button', { name: 'Download & verify' }).click();
  await download;
  await expect(main.getByText('Download verified', { exact: false })).toBeVisible();
});
test('real offline interruption resumes from a positive server offset', async ({
  page,
  context,
}) => {
  await page.goto('/');
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 10,
    downloadThroughput: -1,
    uploadThroughput: 1024 * 1024,
  });
  await page.getByLabel('Choose files', { exact: true }).setInputFiles({
    name: 'connection-test.bin',
    mimeType: 'application/octet-stream',
    buffer: Buffer.alloc(24 * 1024 * 1024, 59),
  });
  const row = page.getByRole('article', { name: 'connection-test.bin', exact: true });
  await expect
    .poll(async () => (await (await page.request.get('/api/uploads')).json())[0]?.offset || 0, {
      timeout: 35000,
    })
    .toBeGreaterThan(0);
  // Use the same CDP session as throttling; a second session's emulation can
  // otherwise be overridden, producing a transfer that never actually failed.
  const failed = page.waitForEvent('requestfailed', { predicate: (r) => r.method() === 'PATCH' });
  await cdp.send('Network.emulateNetworkConditions', {
    offline: true,
    latency: 0,
    downloadThroughput: 0,
    uploadThroughput: 0,
  });
  await failed;
  await page.waitForTimeout(2000);
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 10,
    downloadThroughput: -1,
    uploadThroughput: 1024 * 1024,
  });
  await expect(row.getByRole('button', { name: 'Download & verify' })).toBeVisible({
    timeout: 65000,
  });
  await row.getByText('Transfer details', { exact: true }).click();
  await expect(row.getByText('Connection interrupted', { exact: false }).first()).toBeVisible();
});
test('mobile layout and keyboard can reach the file picker', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Choose files' }).focus();
  await expect(page.getByRole('button', { name: 'Choose files' })).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'artifacts/mobile.png', fullPage: true });
});
