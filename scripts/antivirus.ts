import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import type { PublicUpload } from '../shared/types.ts';
const base = 'http://127.0.0.1:3000';
const created: string[] = [];
const results: {
  scenario: string;
  scan: string;
  scannerVersion: string | null;
  detail: string | null;
}[] = [];
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function get(id: string): Promise<PublicUpload> {
  return (await fetch(`${base}/api/uploads/${id}`)).json();
}
async function upload(bytes: Buffer) {
  const id = randomUUID();
  created.push(id);
  const response = await fetch(`${base}/api/uploads`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': id },
    body: JSON.stringify({
      name: 'scanner-test.bin',
      size: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    }),
  });
  assert.equal(response.status, 201);
  const record: PublicUpload = await response.json();
  assert.equal(
    (
      await fetch(`${base}${record.url}`, {
        method: 'PATCH',
        headers: {
          'Tus-Resumable': '1.0.0',
          'Upload-Offset': '0',
          'Content-Type': 'application/offset+octet-stream',
        },
        body: new Uint8Array(bytes),
      })
    ).status,
    204,
  );
  return id;
}
async function verdict(id: string) {
  for (let i = 0; i < 260; i++) {
    const r = await get(id);
    if (
      ['clean', 'detected', 'inconclusive', 'error'].includes(r.scan) &&
      r.integrity !== 'checking'
    )
      return r;
    await delay(500);
  }
  throw new Error('Scanner did not finish');
}
async function check(id: string, scenario: string, scan: string, downloadStatus: number) {
  const r = await verdict(id);
  assert.equal(r.integrity, 'verified');
  assert.equal(r.scan, scan, r.detail || '');
  assert.equal((await fetch(`${base}/api/uploads/${id}/download`)).status, downloadStatus);
  results.push({ scenario, scan: r.scan, scannerVersion: r.scannerVersion, detail: r.detail });
  process.stdout.write(`PASS ${scenario}\n`);
}
for (let i = 0; i < 90; i++) {
  try {
    if ((await fetch(`${base}/api/health`)).ok) break;
  } catch {
    /* app starting */
  }
  await delay(1000);
}
const health = await (await fetch(`${base}/api/health`)).json();
assert.equal(health.scanRequired, true, 'Start with compose.antivirus.yaml');
// Official harmless EICAR test string, assembled only in memory so host scanners
// do not quarantine a repository fixture. This is not real malware.
const eicar = Buffer.from(
  'WDVPIVAlQEFQWzRcUFpYNTQoUF4pN0NDKTd9JEVJQ0FSLVNUQU5EQVJELUFOVElWSVJVUy1URVNULUZJTEUhJEgrSCo=',
  'base64',
);
try {
  await check(
    await upload(Buffer.from('A harmless text fixture.')),
    'clean file is verified and downloadable',
    'clean',
    200,
  );
  await check(await upload(eicar), 'official EICAR fixture is quarantined', 'detected', 409);
  // Harmless AES-encrypted ZIP, generated with 7-Zip. Its unreadable content
  // must not be represented as a successful scan (fixture password: fixture-only).
  const encrypted = Buffer.from(
    'UEsDBDMAAQBjAPuaNl0AAAAASAAAACwAAAALAAsAbWVzc2FnZS50eHQBmQcAAgBBRQMAAIf9m/QsUK08PXq4LvsCH04KhYw300Ge518O9d+okyfexlol1ZXSelbwKuPIVe128N9745UK0IWBKLGboJ8w9nL67d68L0PdRlBLAQI/ADMAAQBjAPuaNl0AAAAASAAAACwAAAALAC8AAAAAAAAAIAAAAAAAAABtZXNzYWdlLnR4dAoAIAAAAAAAAQAYAI3rwgzhSt0BAAAAAAAAAAAAAAAAAAAAAAGZBwACAEFFAwAAUEsFBgAAAAABAAEAaAAAAHwAAAAAAA==',
    'base64',
  );
  await check(
    await upload(encrypted),
    'encrypted archive is inconclusive and blocked',
    'inconclusive',
    409,
  );
  execFileSync('docker', ['compose', '--profile', 'antivirus', 'stop', 'clamav'], {
    stdio: 'pipe',
  });
  let unavailable: string;
  try {
    unavailable = await upload(Buffer.from('The scanner is deliberately offline.'));
    await check(unavailable, 'scanner outage fails closed', 'error', 409);
  } finally {
    execFileSync('docker', ['compose', '--profile', 'antivirus', 'start', 'clamav'], {
      stdio: 'pipe',
    });
  }
  // Wait for clamd readiness using its real VERSION protocol, not container state.
  for (let i = 0; i < 120; i++) {
    try {
      execFileSync(
        'docker',
        [
          'compose',
          'exec',
          '-T',
          'app',
          'node',
          '--import',
          'tsx',
          '-e',
          "import('./server/scanner.ts').then(m=>m.scannerVersion()).then(v=>{if(!v.startsWith('ClamAV'))process.exit(1)}).catch(()=>process.exit(1))",
        ],
        { stdio: 'pipe' },
      );
      break;
    } catch {
      await delay(1000);
    }
  }
  assert.equal(
    (await fetch(`${base}/api/uploads/${unavailable!}/verify`, { method: 'POST' })).status,
    202,
  );
  await check(unavailable!, 'retry after scanner recovery', 'clean', 200);
} finally {
  for (const id of created)
    await fetch(`${base}/api/uploads/${id}`, { method: 'DELETE' }).catch(() => undefined);
  await mkdir('artifacts', { recursive: true });
  await writeFile(
    'artifacts/antivirus.json',
    JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2),
  );
}
