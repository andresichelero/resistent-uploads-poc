import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createServer, request as httpRequest } from 'node:http';
import type { PublicUpload } from '../shared/types.ts';

const base = process.env.BASE_URL || 'http://127.0.0.1:3000';
const results: { scenario: string; durationMs: number; detail: unknown }[] = [];
const created: string[] = [];
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const tus = { 'Tus-Resumable': '1.0.0' };
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function record(id: string): Promise<PublicUpload> {
  const response = await fetch(`${base}/api/uploads/${id}`);
  assert.equal(response.status, 200);
  return response.json();
}
async function create(bytes: Buffer, hash = sha(bytes)): Promise<PublicUpload> {
  const id = randomUUID();
  created.push(id);
  const response = await fetch(`${base}/api/uploads`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': id },
    body: JSON.stringify({ name: `fixture-${id}.bin`, size: bytes.length, sha256: hash }),
  });
  assert.equal(response.status, 201, await response.clone().text());
  return response.json();
}
async function patch(r: PublicUpload, bytes: Buffer, offset: number, target = base) {
  return fetch(`${target}${r.url}`, {
    method: 'PATCH',
    headers: {
      ...tus,
      'Content-Type': 'application/offset+octet-stream',
      'Upload-Offset': String(offset),
    },
    body: new Uint8Array(bytes),
    signal: AbortSignal.timeout(45000),
  });
}
async function offset(r: PublicUpload) {
  const response = await fetch(`${base}${r.url}`, { method: 'HEAD', headers: tus });
  assert.equal(response.status, 200);
  return Number(response.headers.get('upload-offset'));
}
async function waitVerified(id: string) {
  for (let i = 0; i < 100; i++) {
    const r = await record(id);
    if (
      ['verified', 'mismatch', 'error'].includes(r.integrity) &&
      !['checking', 'pending'].includes(r.scan)
    )
      return r;
    await delay(500);
  }
  throw new Error('Verification timed out');
}
async function healthy() {
  for (let i = 0; i < 90; i++) {
    try {
      if ((await fetch(`${base}/api/health`)).ok) return;
    } catch {
      /* restart */
    }
    await delay(1000);
  }
  throw new Error('Services did not become healthy');
}
async function scenario(name: string, run: () => Promise<unknown>) {
  const started = Date.now();
  const detail = await run();
  results.push({ scenario: name, durationMs: Date.now() - started, detail });
  process.stdout.write(`PASS ${name}\n`);
}

await healthy();
try {
  await scenario('concurrent uploads, offset conflict and independent hashes', async () => {
    const data = [Buffer.alloc(12 * 1024 * 1024, 19), Buffer.alloc(10 * 1024 * 1024, 23)];
    const uploads = await Promise.all(data.map((b) => create(b)));
    await Promise.all(
      uploads.map(async (r, i) => {
        assert.equal((await patch(r, data[i].subarray(0, 8 * 1024 * 1024), 0)).status, 204);
        assert.equal(await offset(r), 8 * 1024 * 1024);
        assert.equal((await patch(r, Buffer.from('wrong'), 0)).status, 409);
        assert.equal(await offset(r), 8 * 1024 * 1024);
        assert.equal(
          (await patch(r, data[i].subarray(8 * 1024 * 1024), 8 * 1024 * 1024)).status,
          204,
        );
        const done = await waitVerified(r.id);
        assert.equal(done.integrity, 'verified');
        assert.equal(done.actualSha256, sha(data[i]));
        const download = await fetch(`${base}/api/uploads/${r.id}/download`);
        assert.equal(download.status, 200);
        assert.equal(sha(new Uint8Array(await download.arrayBuffer())), sha(data[i]));
      }),
    );
    return data.map((b) => ({ bytes: b.length, sha256: sha(b) }));
  });
  await scenario('lost response after accepted PATCH; measured restart comparison', async () => {
    let received = 0,
      drop = true;
    const proxy = createServer((req, res) => {
      const target = httpRequest(
        `${base}${req.url}`,
        { method: req.method, headers: { ...req.headers, host: new URL(base).host } },
        (upstream) => {
          upstream.resume();
          upstream.on('end', () => {
            if (drop) {
              drop = false;
              res.destroy();
            } else {
              res.writeHead(upstream.statusCode!, upstream.headers);
              res.end();
            }
          });
        },
      );
      req.on('data', (chunk) => {
        received += chunk.length;
      });
      target.on('error', () => res.destroy());
      req.pipe(target);
    });
    await new Promise<void>((resolve) => proxy.listen(3009, '127.0.0.1', resolve));
    const bytes = Buffer.alloc(16 * 1024 * 1024, 47),
      half = bytes.length / 2;
    try {
      const r = await create(bytes);
      await assert.rejects(patch(r, bytes.subarray(0, half), 0, 'http://127.0.0.1:3009'));
      assert.equal(await offset(r), half);
      assert.equal(
        (await patch(r, bytes.subarray(half), half, 'http://127.0.0.1:3009')).status,
        204,
      );
      assert.equal((await waitVerified(r.id)).actualSha256, sha(bytes));
      const resumedBytes = received;
      received = 0;
      drop = true;
      const abandoned = await create(bytes);
      await assert.rejects(patch(abandoned, bytes.subarray(0, half), 0, 'http://127.0.0.1:3009'));
      const restarted = await create(bytes);
      assert.equal((await patch(restarted, bytes, 0, 'http://127.0.0.1:3009')).status, 204);
      assert.equal((await waitVerified(restarted.id)).actualSha256, sha(bytes));
      assert.equal(resumedBytes, bytes.length);
      assert.equal(received, bytes.length + half);
      return {
        originalBytes: bytes.length,
        recoveredOffset: half,
        resumedBodyBytes: resumedBytes,
        restartedBodyBytes: received,
        boundary:
          'PATCH body bytes received by the test HTTP proxy; excludes HTTP headers and TCP retransmission',
        sha256: sha(bytes),
      };
    } finally {
      await new Promise<void>((resolve) => proxy.close(() => resolve()));
    }
  });
  await scenario(
    'same-resource concurrent PATCH requests serialize without corruption',
    async () => {
      const bytes = Buffer.alloc(10 * 1024 * 1024, 11),
        r = await create(bytes);
      const responses = await Promise.all([
        patch(r, bytes.subarray(0, 5 * 1024 * 1024), 0),
        patch(r, bytes.subarray(0, 5 * 1024 * 1024), 0),
      ]);
      // tusd may interrupt the first writer to grant the second its lock; 400 is
      // ERR_UPLOAD_INTERRUPTED, not permission to assume the first chunk committed.
      assert.ok(responses.every((r) => [204, 400, 409].includes(r.status)));
      for (const response of responses)
        if (response.status === 400) assert.match(await response.text(), /ERR_UPLOAD_INTERRUPTED/);
      const recovered = await offset(r);
      assert.ok(recovered >= 0 && recovered <= 5 * 1024 * 1024);
      assert.equal((await patch(r, bytes.subarray(recovered), recovered)).status, 204);
      assert.equal((await waitVerified(r.id)).actualSha256, sha(bytes));
      return {
        bytes: bytes.length,
        recoveredOffset: recovered,
        statuses: responses.map((r) => r.status),
      };
    },
  );
  await scenario('process restart preserves confirmed data', async () => {
    const bytes = Buffer.alloc(12 * 1024 * 1024, 31),
      r = await create(bytes),
      checkpoint = 8 * 1024 * 1024;
    assert.equal((await patch(r, bytes.subarray(0, checkpoint), 0)).status, 204);
    execFileSync('docker', ['compose', 'restart', 'tusd', 'app'], { stdio: 'pipe' });
    await healthy();
    assert.equal(await offset(r), checkpoint);
    assert.equal((await patch(r, bytes.subarray(checkpoint), checkpoint)).status, 204);
    assert.equal((await waitVerified(r.id)).actualSha256, sha(bytes));
    return { recoveredOffset: checkpoint, sha256: sha(bytes) };
  });
  await scenario('hash mismatch blocks download and raw tus GET', async () => {
    const bytes = Buffer.from('deliberately altered content'),
      r = await create(bytes, 'a'.repeat(64));
    assert.equal((await patch(r, bytes, 0)).status, 204);
    assert.equal((await waitVerified(r.id)).integrity, 'mismatch');
    assert.equal((await fetch(`${base}/api/uploads/${r.id}/download`)).status, 409);
    assert.equal((await fetch(`${base}${r.url}`)).status, 405);
    return { blocked: true };
  });
  await scenario('empty file, size limit, origin policy and cancellation', async () => {
    const empty = await create(Buffer.alloc(0));
    assert.equal((await waitVerified(empty.id)).integrity, 'verified');
    const oversized = await fetch(`${base}/api/uploads`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() },
      body: JSON.stringify({ name: 'too-large.bin', size: 104857601, sha256: 'a'.repeat(64) }),
    });
    assert.equal(oversized.status, 400);
    assert.equal(
      (await fetch(`${base}/api/uploads`, { headers: { Origin: 'https://untrusted.example' } }))
        .status,
      403,
    );
    const r = await create(Buffer.alloc(10));
    assert.equal((await fetch(`${base}/api/uploads/${r.id}`, { method: 'DELETE' })).status, 204);
    assert.equal((await fetch(`${base}${r.url}`, { method: 'HEAD', headers: tus })).status, 404);
    return { emptySha256: sha(Buffer.alloc(0)), cancellationConfirmed: true };
  });
  await scenario('storage outage never reports success', async () => {
    const bytes = Buffer.alloc(1024, 7),
      r = await create(bytes);
    execFileSync('docker', ['compose', 'stop', 'storage'], { stdio: 'pipe' });
    try {
      assert.equal((await fetch(`${base}/api/health`)).status, 503);
      const blocked = await fetch(`${base}/api/uploads/${r.id}/download`);
      assert.equal(blocked.status, 409);
    } finally {
      execFileSync('docker', ['compose', 'start', 'storage'], { stdio: 'pipe' });
      await healthy();
    }
    assert.equal((await patch(r, bytes, 0)).status, 204);
    assert.equal((await waitVerified(r.id)).actualSha256, sha(bytes));
    return { recovered: true };
  });
} finally {
  for (const id of created)
    await fetch(`${base}/api/uploads/${id}`, { method: 'DELETE' }).catch(() => undefined);
  await mkdir('artifacts', { recursive: true });
  await writeFile(
    'artifacts/integration.json',
    JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2),
  );
}
