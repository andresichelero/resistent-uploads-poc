import { afterEach, expect, it, vi } from 'vitest';
import type { PublicUpload } from '../shared/types';
import { Transfers } from '../src/transfers';
vi.mock('../src/hash', () => ({ hashFile: async () => 'a'.repeat(64) }));
vi.mock('tus-js-client', () => ({
  Upload: class {
    start() {}
    async abort() {}
  },
  DetailedError: class extends Error {},
}));
const record = (id: string, url: string | null): PublicUpload => ({
  id,
  name: 'a.txt',
  size: 1,
  sha256: 'a'.repeat(64),
  tusId: url ? 'remote' : null,
  offset: 0,
  createdAt: Date.now(),
  updatedAt: Date.now(),
  integrity: 'pending',
  actualSha256: null,
  scan: 'not_run',
  scannerVersion: null,
  detail: null,
  deleting: false,
  downloadable: false,
  url,
});
afterEach(() => vi.unstubAllGlobals());
it('preserves deletion intent for completed files when only polling recovers', async () => {
  const transfers = new Transfers();
  const id = crypto.randomUUID();
  const done: PublicUpload = {
    ...record(id, '/files/remote'),
    integrity: 'verified',
    downloadable: true,
  };
  let deletes = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'DELETE') {
        deletes++;
        if (deletes === 1) throw new Error('service offline');
        return new Response(null, { status: 204 });
      }
      return Response.json([done]);
    }),
  );
  await transfers.refresh();
  await transfers.remove(id);
  expect(transfers.items[0].phase).toBe('deleting');
  await transfers.refresh();
  await vi.waitFor(() => expect(transfers.items).toHaveLength(0));
  expect(deletes).toBe(2);
});
it('retries creation when polling recovered a record with no tus URL', async () => {
  const transfers = new Transfers();
  let id = '',
    posts = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        id = (init.headers as Record<string, string>)['Idempotency-Key'];
        posts++;
        return posts === 1
          ? Response.json({ error: 'tus unavailable' }, { status: 503 })
          : Response.json(record(id, '/files/remote'), { status: 201 });
      }
      return Response.json([record(id, null)]);
    }),
  );
  await transfers.add(new File(['a'], 'a.txt'));
  await transfers.refresh();
  transfers.start(id);
  await vi.waitFor(() => expect(posts).toBe(2));
  expect(transfers.items[0].record?.url).toBe('/files/remote');
});
it('retries a cancellation that never reached the server while offline', async () => {
  const transfers = new Transfers();
  let id = '',
    deletes = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        id = (init.headers as Record<string, string>)['Idempotency-Key'];
        return Response.json(record(id, '/files/remote'));
      }
      if (init?.method === 'DELETE') {
        deletes++;
        if (deletes === 1) throw new Error('offline');
        return new Response(null, { status: 204 });
      }
      return Response.json([record(id, '/files/remote')]);
    }),
  );
  await transfers.add(new File(['a'], 'a.txt'));
  await transfers.remove(id);
  expect(transfers.items[0].phase).toBe('deleting');
  transfers.online();
  await vi.waitFor(() => expect(transfers.items).toHaveLength(0));
  expect(deletes).toBe(2);
});
