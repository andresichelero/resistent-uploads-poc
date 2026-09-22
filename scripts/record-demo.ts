import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
const base = 'http://127.0.0.1:3000';
await mkdir('artifacts/demo', { recursive: true });
const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1440, height: 1080 },
  recordVideo: { dir: 'artifacts/demo', size: { width: 1440, height: 1080 } },
});
const page = await context.newPage();
const timeline: { seconds: number; event: string }[] = [];
const started = Date.now();
const mark = (event: string) =>
  timeline.push({ seconds: Math.round((Date.now() - started) / 1000), event });
try {
  const records = await (await page.request.get(`${base}/api/uploads`)).json();
  for (const r of records) await page.request.delete(`${base}/api/uploads/${r.id}`);
  await page.goto(base);
  await page.waitForTimeout(2000);
  mark('Local workbench, integrity mode');
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  const network = {
    offline: false,
    latency: 15,
    downloadThroughput: 10 * 1024 * 1024,
    uploadThroughput: 1024 * 1024,
  };
  await cdp.send('Network.emulateNetworkConditions', network);
  await page.getByLabel('Choose files', { exact: true }).setInputFiles([
    {
      name: 'field-recording.raw',
      mimeType: 'application/octet-stream',
      buffer: Buffer.alloc(32 * 1024 * 1024, 73),
    },
    {
      name: 'session-notes.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('Field recording — verify every byte after reconnecting.'),
    },
  ]);
  mark('Two independent transfers start');
  const row = page.getByRole('article', { name: 'field-recording.raw', exact: true });
  await expect
    .poll(
      async () =>
        (await (await page.request.get(`${base}/api/uploads`)).json()).find(
          (r: { name: string }) => r.name === 'field-recording.raw',
        )?.offset || 0,
      { timeout: 35000 },
    )
    .toBeGreaterThan(0);
  await row.getByRole('button', { name: 'Pause', exact: true }).click();
  mark('Manual pause preserves confirmed bytes');
  await page.waitForTimeout(4000);
  await row.getByRole('button', { name: 'Resume', exact: true }).click();
  await page.waitForTimeout(3000);
  const failure = page.waitForEvent('requestfailed', {
    predicate: (req) => req.method() === 'PATCH',
  });
  await cdp.send('Network.emulateNetworkConditions', {
    offline: true,
    latency: 0,
    downloadThroughput: 0,
    uploadThroughput: 0,
  });
  await failure;
  mark('Real transport failure: PATCH request failed');
  await page.waitForTimeout(4000);
  await cdp.send('Network.emulateNetworkConditions', network);
  mark('Connection restored; reconcile remote offset');
  await expect(row.getByRole('button', { name: 'Download & verify' })).toBeVisible({
    timeout: 90000,
  });
  mark('Stored file verified independently');
  await row.getByText('Transfer details', { exact: true }).click();
  await page.screenshot({ path: 'artifacts/screenshot.png', fullPage: true });
  const download = page.waitForEvent('download');
  await row.getByRole('button', { name: 'Download & verify' }).click();
  await download;
  await expect(row.getByText('Download verified', { exact: false })).toBeVisible();
  mark('Downloaded file matches original SHA-256');
  await page.waitForTimeout(Math.max(5000, 70000 - (Date.now() - started)));
  await writeFile('artifacts/demo/timeline.json', JSON.stringify(timeline, null, 2));
} finally {
  await context.close();
  await browser.close();
}
