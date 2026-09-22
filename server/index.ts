import Fastify from 'fastify';
import proxy from '@fastify/http-proxy';
import staticFiles from '@fastify/static';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { Records } from './db.ts';
import { UploadService, tusUrl, scanRequired } from './service.ts';
import { validateInput } from './policy.ts';
import { storageHealthy, objectStream } from './storage.ts';
import { MAX_SIZE } from '../shared/types.ts';

const db = new Records(process.env.DB_PATH || 'data/uploads.sqlite');
const service = new UploadService(db);
const app = Fastify({ logger: true, bodyLimit: 8192 });
const hooks = Fastify({ bodyLimit: 16384 });
const creating = new Map<string, Promise<void>>();
app.addHook('onRequest', async (req, reply) => {
  const host = req.headers.host || '';
  if (!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)) return reply.code(403).send({ error: 'This demo is available on localhost only.' });
  const origin = req.headers.origin;
  if (origin && origin !== `http://${host}`) return reply.code(403).send({ error: 'Cross-origin requests are not allowed.' });
  if (req.headers['sec-fetch-site'] === 'cross-site') return reply.code(403).send({ error: 'Cross-site requests are not allowed.' });
  reply.header('X-Content-Type-Options', 'nosniff').header('Cache-Control', 'no-store');
});
app.get('/api/health', async (_, reply) => {
  try {
    await storageHealthy();
    const response = await fetch(`${tusUrl}/files/`, { method: 'OPTIONS', signal: AbortSignal.timeout(3000) });
    if (!response.ok) throw new Error('tus unavailable');
    return { status: 'ready', scanRequired, maxSize: MAX_SIZE, retentionHours: 24 };
  } catch { return reply.code(503).send({ status: 'starting', scanRequired, maxSize: MAX_SIZE, retentionHours: 24 }); }
});
app.get('/api/uploads', () => db.all().map(r => service.public(r)));
app.post('/api/uploads', async (req, reply) => {
  let input; try { input = validateInput(req.body); } catch (error) { return reply.code(400).send({ error: (error as Error).message }); }
  const id = req.headers['idempotency-key'];
  if (typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id)) return reply.code(400).send({ error: 'A UUID v4 Idempotency-Key is required.' });
  const existing = db.get(id);
  if (existing && (existing.sha256 !== input.sha256 || existing.size !== input.size || existing.name !== input.name)) return reply.code(409).send({ error: 'This request ID belongs to another file.' });
  if (!existing) db.put({ ...input, id, tusId: null, offset: 0, createdAt: Date.now(), updatedAt: Date.now(), integrity: 'pending', actualSha256: null, scan: scanRequired ? 'pending' : 'not_run', scannerVersion: null, detail: null, deleting: false });
  if (db.get(id)?.deleting) return reply.code(409).send({ error: 'This upload is being deleted.' });
  if (!db.get(id)?.tusId && !creating.has(id)) {
    const creation = (async () => {
      const response = await fetch(`${tusUrl}/files/`, { method: 'POST', headers: { 'Tus-Resumable': '1.0.0', 'Upload-Length': String(input.size), 'Upload-Metadata': `recordId ${Buffer.from(id).toString('base64')}` }, signal: AbortSignal.timeout(30000) });
      if (response.status !== 201) throw new Error('Upload service could not create the transfer. Retry with the same file.');
      const location = response.headers.get('location'); if (!location) throw new Error('Upload service returned no location.');
      const tusId = decodeURIComponent(new URL(location, tusUrl).pathname.split('/').pop()!);
      db.patch(id, { tusId });
    })();
    creating.set(id, creation); void creation.finally(() => creating.delete(id)).catch(() => undefined);
  }
  try { await creating.get(id); return reply.code(201).send(service.public(db.get(id)!)); }
  catch (error) { return reply.code(503).send({ error: (error as Error).message }); }
});
app.get<{ Params: { id: string } }>('/api/uploads/:id', (req, reply) => {
  const r = db.get(req.params.id); return r ? service.public(r) : reply.code(404).send({ error: 'Upload not found.' });
});
app.delete<{ Params: { id: string } }>('/api/uploads/:id', async (req, reply) => {
  try { await service.remove(req.params.id); return reply.code(204).send(); }
  catch { return reply.code(503).send({ error: 'Deletion pending. Storage will be retried automatically.' }); }
});
app.post<{ Params: { id: string } }>('/api/uploads/:id/verify', async (req, reply) => {
  const r = db.get(req.params.id);
  if (!r) return reply.code(404).send();
  if (r.offset !== r.size || !r.tusId || r.deleting) return reply.code(409).send({ error: 'Finish the upload before verification.' });
  // Block download before scheduling async work, including during re-verification.
  db.patch(r.id, { integrity: 'pending' }); void service.verify(r.id);
  return reply.code(202).send({ status: 'queued' });
});
app.get<{ Params: { id: string } }>('/api/uploads/:id/download', async (req, reply) => {
  const r = db.get(req.params.id);
  if (!r) return reply.code(404).send();
  if (!service.public(r).downloadable || !r.tusId) return reply.code(409).send({ error: 'Download is blocked until the required checks pass.' });
  try {
    const { stream, length } = await objectStream(r.tusId);
    reply.header('Content-Type', 'application/octet-stream').header('Content-Disposition', `attachment; filename="download"; filename*=UTF-8''${encodeURIComponent(r.name)}`).header('Content-Length', length!).header('X-Content-SHA256', r.actualSha256!);
    return reply.send(stream);
  } catch { return reply.code(503).send({ error: 'Storage unavailable.' }); }
});

await app.register(proxy, {
  upstream: tusUrl, prefix: '/files', rewritePrefix: '/files',
  preHandler: async (req, reply) => {
    if (!['HEAD', 'PATCH', 'OPTIONS'].includes(req.method)) return reply.code(405).send({ error: 'Use the application API to create or delete transfers.' });
    if (req.method === 'OPTIONS') return;
    let tusId: string; try { tusId = decodeURIComponent(req.url.split('/files/')[1]?.split('?')[0] || ''); } catch { return reply.code(400).send(); }
    const record = db.all().find(r => r.tusId === tusId);
    if (!record || record.deleting) return reply.code(404).send();
    if (req.method === 'PATCH') {
      if (record.integrity !== 'pending') return reply.code(409).send({ error: 'Transfer already completed.' });
      db.patch(record.id, { updatedAt: Date.now() });
    }
  },
});

interface Hook { Type: string; Event: { Upload: { ID: string; Size: number; Offset: number; MetaData: { recordId?: string } } } }
hooks.post<{ Body: Hook }>('/hooks', async (req) => {
  const { Type, Event } = req.body; const upload = Event.Upload;
  const id = upload.MetaData?.recordId; const record = id ? db.get(id) : undefined;
  if (Type === 'pre-create') return !record || record.deleting || record.tusId || record.size !== upload.Size ? { RejectUpload: true } : {};
  if (record && !record.deleting) {
    db.patch(record.id, { tusId: upload.ID });
    if (Type === 'post-finish') { db.patch(record.id, { offset: record.size }); void service.verify(record.id); }
  }
  return {};
});
if (existsSync(resolve('dist'))) await app.register(staticFiles, { root: resolve('dist'), index: 'index.html' });
await hooks.listen({ port: 3001, host: process.env.HOST || '127.0.0.1' });
await app.listen({ port: 3000, host: process.env.HOST || '127.0.0.1' });
const timer = setInterval(() => void service.reconcile(), 2000);
void service.reconcile();
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { clearInterval(timer); await app.close(); await hooks.close(); process.exit(0); });
