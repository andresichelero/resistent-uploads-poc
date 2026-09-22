import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Readable } from 'node:stream';
import { createHash } from 'node:crypto';
import { Records } from '../server/db';
import { UploadService } from '../server/service';
import { objectStream } from '../server/storage';
import type { UploadRecord } from '../shared/types';
vi.mock('../server/storage', () => ({ objectStream: vi.fn() }));
const bytes = Buffer.from('verified content');
let db: Records, service: UploadService;
const initial = (): UploadRecord => ({
  id: 'a',
  name: 'example.txt',
  size: bytes.length,
  sha256: createHash('sha256').update(bytes).digest('hex'),
  tusId: 'remote',
  offset: bytes.length,
  createdAt: Date.now(),
  updatedAt: Date.now(),
  integrity: 'pending',
  actualSha256: null,
  scan: 'not_run',
  scannerVersion: null,
  detail: null,
  deleting: false,
});
beforeEach(() => {
  db = new Records(':memory:');
  service = new UploadService(db);
  db.put(initial());
  vi.mocked(objectStream).mockImplementation(async () => ({
    stream: Readable.from([bytes]),
    length: bytes.length,
  }));
});
afterEach(() => {
  db.close();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
describe('verification and retention', () => {
  it('retains a cancellation tombstone until an in-flight creation settles', async () => {
    db.patch('a', { tusId: null });
    service.creating.add('a');
    await expect(service.remove('a')).rejects.toThrow();
    expect(db.get('a')?.deleting).toBe(true);
    db.patch('a', { tusId: 'created-after-cancel' });
    service.creating.delete('a');
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetcher);
    await service.reconcile();
    expect(fetcher.mock.calls[0][0]).toContain('created-after-cancel');
    expect(db.get('a')).toBeUndefined();
  });
  it('does not erase an existing malware verdict when basic mode re-verifies', async () => {
    db.patch('a', { scan: 'detected' });
    await service.verify('a');
    expect(db.get('a')?.scan).toBe('detected');
    expect(service.public(db.get('a')!).downloadable).toBe(false);
  });
  it('blocks corrupt or unavailable content', async () => {
    vi.mocked(objectStream).mockResolvedValueOnce({
      stream: Readable.from(['altered']),
      length: 7,
    });
    await service.verify('a');
    expect(db.get('a')?.integrity).toBe('mismatch');
    vi.mocked(objectStream).mockRejectedValueOnce(new Error('offline'));
    await service.verify('a');
    expect(db.get('a')?.integrity).toBe('error');
  });
  it('never probes HEAD or expires a currently active PATCH', async () => {
    db.patch('a', { updatedAt: 0 });
    service.active.set('a', 1);
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    await service.reconcile();
    expect(fetcher).not.toHaveBeenCalled();
    expect(db.get('a')).toBeDefined();
  });
  it('persists pending cleanup through outages and retries before dropping metadata', async () => {
    db.patch('a', { updatedAt: 0 });
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetcher);
    await service.reconcile();
    expect(db.get('a')?.deleting).toBe(true);
    await service.reconcile();
    expect(db.get('a')).toBeUndefined();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
