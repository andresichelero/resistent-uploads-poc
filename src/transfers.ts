import { Upload, DetailedError } from 'tus-js-client';
import { createSHA256 } from 'hash-wasm';
import { hashFile } from './hash';
import { TransferRate } from '../shared/rate';
import { CHUNK_SIZE, MAX_SIZE, type PublicUpload } from '../shared/types';

export type Phase =
  | 'hashing'
  | 'uploading'
  | 'paused'
  | 'waiting'
  | 'reselect'
  | 'verifying'
  | 'done'
  | 'error'
  | 'deleting';
export interface Transfer {
  id: string;
  name: string;
  size: number;
  sent: number;
  confirmed: number;
  phase: Phase;
  retries: number;
  message: string;
  events: string[];
  record?: PublicUpload;
  rate: TransferRate;
  hashProgress: number;
  download?: { bytes: number; rate: TransferRate; state: string };
}
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `Request failed (${response.status})`);
  }
  return response.status === 204 ? (undefined as T) : response.json();
}
export class Transfers {
  items: Transfer[] = [];
  private listeners = new Set<() => void>();
  private files = new Map<string, File>();
  private uploads = new Map<string, Upload>();
  private versions = new Map<string, number>();
  private deleting = new Set<string>();
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  snapshot = () => this.items;
  private emit() {
    this.items = [...this.items];
    this.listeners.forEach((fn) => fn());
  }
  private change(id: string, update: Partial<Transfer>) {
    this.items = this.items.map((r) => (r.id === id ? { ...r, ...update } : r));
    this.emit();
  }
  private get(id: string) {
    return this.items.find((r) => r.id === id);
  }
  private event(id: string, text: string) {
    const r = this.get(id);
    if (r)
      this.change(id, {
        events: [...r.events.slice(-19), `${new Date().toLocaleTimeString()}  ${text}`],
      });
  }
  async refresh() {
    const records = await api<PublicUpload[]>('/api/uploads');
    for (const record of records) {
      let r = this.get(record.id);
      if (!r) {
        r = {
          id: record.id,
          name: record.name,
          size: record.size,
          sent: record.offset,
          confirmed: record.offset,
          phase: 'reselect',
          retries: 0,
          message: '',
          events: [],
          rate: new TransferRate(),
          hashProgress: 0,
        };
        this.items.push(r);
      }
      let phase = r.phase;
      if (r.phase === 'deleting' || record.deleting) phase = 'deleting';
      else if (record.integrity !== 'pending')
        phase = record.downloadable
          ? 'done'
          : ['error', 'mismatch'].includes(record.integrity) ||
              ['error', 'detected', 'inconclusive'].includes(record.scan)
            ? 'error'
            : 'verifying';
      this.items = this.items.map((item) =>
        item.id === record.id
          ? { ...item, record, phase, confirmed: Math.max(item.confirmed, record.offset) }
          : item,
      );
    }
    const ids = new Set(records.map((r) => r.id));
    this.items = this.items.filter((r) => r.phase !== 'deleting' || ids.has(r.id));
    this.emit();
    // A service outage may recover without a browser 'online' event.
    for (const item of this.items) if (item.phase === 'deleting') void this.remove(item.id);
  }
  async add(file: File) {
    const id = crypto.randomUUID();
    this.items.push({
      id,
      name: file.name,
      size: file.size,
      sent: 0,
      confirmed: 0,
      phase: 'hashing',
      retries: 0,
      message: '',
      events: [],
      rate: new TransferRate(),
      hashProgress: 0,
    });
    this.emit();
    this.files.set(id, file);
    await this.prepare(id, file);
  }
  private async prepare(id: string, file: File) {
    const version = (this.versions.get(id) || 0) + 1;
    this.versions.set(id, version);
    try {
      if (file.size > MAX_SIZE) throw new Error('This demo accepts files up to 100 MiB.');
      this.change(id, { phase: 'hashing', message: '', hashProgress: 0 });
      const digest = await hashFile(file, (hashProgress) => this.change(id, { hashProgress }));
      if (this.versions.get(id) !== version) return;
      const prior = this.get(id)?.record;
      if (prior && (prior.sha256 !== digest || prior.size !== file.size)) {
        this.change(id, {
          phase: 'reselect',
          message: 'Different content. Select the original file to continue this upload.',
        });
        return;
      }
      const record =
        (prior?.url ? prior : null) ||
        (await api<PublicUpload>('/api/uploads', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Idempotency-Key': id },
          body: JSON.stringify({ name: file.name, size: file.size, sha256: digest }),
        }));
      if (this.versions.get(id) !== version) {
        await api(`/api/uploads/${id}`, { method: 'DELETE' });
        return;
      }
      this.files.set(id, file);
      this.change(id, { record, confirmed: record.offset });
      this.event(id, 'Content identity confirmed (SHA-256).');
      this.start(id);
    } catch (error) {
      this.change(id, { phase: 'error', message: (error as Error).message });
    }
  }
  reselect(id: string, file: File) {
    return this.prepare(id, file);
  }
  start(id: string) {
    const r = this.get(id),
      file = this.files.get(id);
    if (!r || !file) {
      this.change(id, { phase: 'reselect' });
      return;
    }
    if (!r.record?.url) {
      void this.prepare(id, file);
      return;
    }
    r.rate.reset();
    this.change(id, { phase: 'uploading', message: '' });
    let upload = this.uploads.get(id);
    if (!upload) {
      upload = new Upload(file, {
        uploadUrl: r.record.url,
        chunkSize: CHUNK_SIZE,
        retryDelays: [0, 1000, 3000, 5000, 10000],
        storeFingerprintForResuming: false,
        onProgress: (sent) => {
          const task = this.get(id);
          if (task?.phase === 'uploading') {
            task.rate.add(sent);
            this.change(id, { sent });
          }
        },
        onAfterResponse: (request, response) => {
          if (['HEAD', 'PATCH'].includes(request.getMethod())) {
            const offset = response.getHeader('Upload-Offset');
            if (offset !== undefined && /^\d+$/.test(offset)) {
              this.change(id, { confirmed: Number(offset) });
              this.event(
                id,
                `${request.getMethod()} confirmed ${Number(offset).toLocaleString()} bytes.`,
              );
            }
          }
        },
        onShouldRetry: (error) => {
          const status = error.originalResponse?.getStatus() || 0;
          const interrupted =
            status === 400 && error.originalResponse?.getBody().includes('ERR_UPLOAD_INTERRUPTED');
          const retry =
            status === 0 || status >= 500 || [409, 423, 429].includes(status) || !!interrupted;
          if (retry) {
            const task = this.get(id);
            if (task) this.change(id, { retries: task.retries + 1 });
            this.event(id, `Connection interrupted (${status || 'network'}); reconciling offset.`);
          }
          return retry;
        },
        onError: (error) => {
          const status =
            error instanceof DetailedError ? error.originalResponse?.getStatus() || 0 : 0;
          this.change(id, {
            phase: status === 0 || status >= 500 ? 'waiting' : 'error',
            message:
              status === 0 || status >= 500
                ? 'Connection unavailable. Resume when it returns.'
                : `Upload stopped (${status}).`,
          });
        },
        onSuccess: () => {
          this.change(id, { phase: 'verifying', sent: file.size, confirmed: file.size });
          this.event(id, 'Transfer complete. Waiting for independent verification.');
          void this.refresh();
        },
      });
      this.uploads.set(id, upload);
    }
    upload.start();
  }
  async pause(id: string) {
    this.change(id, { phase: 'paused' });
    await this.uploads.get(id)?.abort();
    this.get(id)?.rate.reset();
    this.event(id, 'Paused by you. Confirmed data is retained.');
  }
  async remove(id: string) {
    if (this.deleting.has(id)) return;
    this.deleting.add(id);
    this.versions.set(id, (this.versions.get(id) || 0) + 1);
    this.change(id, { phase: 'deleting', message: '' });
    await this.uploads.get(id)?.abort();
    try {
      await api(`/api/uploads/${id}`, { method: 'DELETE' });
      this.items = this.items.filter((r) => r.id !== id);
      this.files.delete(id);
      this.uploads.delete(id);
      this.emit();
    } catch (error) {
      this.change(id, { message: (error as Error).message });
    } finally {
      this.deleting.delete(id);
    }
  }
  online = () => {
    for (const r of this.items) {
      if (r.phase === 'waiting') this.start(r.id);
      if (r.phase === 'deleting') void this.remove(r.id);
    }
  };
  async verify(id: string) {
    try {
      await api(`/api/uploads/${id}/verify`, { method: 'POST' });
      this.change(id, { phase: 'verifying', message: '' });
    } catch (e) {
      this.change(id, { message: (e as Error).message });
    }
  }
  async download(id: string) {
    const r = this.get(id);
    if (!r) return;
    const rate = new TransferRate();
    this.change(id, { download: { bytes: 0, rate, state: 'Downloading' } });
    try {
      const response = await fetch(`/api/uploads/${id}/download`);
      if (!response.ok || !response.body) throw new Error('Download is unavailable.');
      const reader = response.body.getReader();
      const chunks: Uint8Array<ArrayBuffer>[] = [];
      let bytes = 0;
      const hash = await createSHA256();
      hash.init();
      rate.add(0);
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          bytes += value.length;
          if (bytes > MAX_SIZE) throw new Error('Download exceeded the size limit.');
          hash.update(value);
          chunks.push(new Uint8Array(value));
          rate.add(bytes);
          this.change(id, { download: { bytes, rate, state: 'Downloading' } });
        }
      } finally {
        await reader.cancel();
      }
      if (bytes !== r.size || hash.digest('hex') !== r.record?.sha256)
        throw new Error('Downloaded content did not match. File was not saved.');
      const url = URL.createObjectURL(new Blob(chunks));
      const link = document.createElement('a');
      link.href = url;
      link.download = r.name;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      this.change(id, { download: { bytes, rate, state: 'Download verified' } });
      this.event(id, 'Downloaded bytes independently match the original SHA-256.');
    } catch (error) {
      this.change(id, { download: { bytes: 0, rate, state: (error as Error).message } });
    }
  }
}
