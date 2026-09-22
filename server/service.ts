import { createHash } from 'node:crypto';
import type { Records } from './db.ts';
import { objectStream } from './storage.ts';
import { scanStream, scannerVersion } from './scanner.ts';
import { canDownload } from './policy.ts';
import type { UploadRecord, PublicUpload } from '../shared/types.ts';
export const tusUrl = process.env.TUS_URL || 'http://127.0.0.1:8080';
export const scanRequired = process.env.SCAN_REQUIRED === 'true';
export class UploadService {
  readonly creating = new Set<string>();
  readonly active = new Map<string, number>();
  private busy = new Set<string>();
  private reconciling = false;
  constructor(readonly db: Records) {}
  public(r: UploadRecord): PublicUpload {
    return {
      ...r,
      url: r.tusId ? `/files/${encodeURIComponent(r.tusId)}` : null,
      downloadable: !r.deleting && canDownload(r.integrity, r.scan, scanRequired),
    };
  }
  async verify(id: string) {
    if (this.busy.has(id)) return;
    const r = this.db.get(id);
    if (!r?.tusId || r.deleting) return;
    this.busy.add(id);
    this.db.patch(id, { integrity: 'checking', detail: null });
    try {
      const hash = createHash('sha256');
      let size = 0;
      const { stream } = await objectStream(r.tusId);
      for await (const chunk of stream) {
        size += chunk.length;
        hash.update(chunk);
      }
      const actualSha256 = hash.digest('hex');
      if (size !== r.size || actualSha256 !== r.sha256) {
        this.db.patch(id, {
          integrity: 'mismatch',
          actualSha256,
          detail: 'The stored content does not match the original file.',
        });
        return;
      }
      this.db.patch(id, {
        integrity: 'verified',
        actualSha256,
        scan: scanRequired ? 'pending' : r.scan,
      });
      if (scanRequired) {
        try {
          const version = await scannerVersion();
          const { stream: scanBody } = await objectStream(r.tusId);
          const result = await scanStream(scanBody);
          this.db.patch(id, { ...result, scannerVersion: version });
        } catch {
          this.db.patch(id, {
            scan: 'error',
            detail:
              'Scanner unavailable or timed out. Download remains blocked; retry verification.',
          });
        }
      }
    } catch {
      this.db.patch(id, {
        integrity: 'error',
        detail: 'Storage verification failed. Retry when storage is available.',
      });
    } finally {
      this.busy.delete(id);
    }
  }
  async remove(id: string) {
    const r = this.db.get(id);
    if (!r) return;
    this.db.patch(id, { deleting: true });
    if (this.creating.has(id)) throw new Error('Creation is settling; deletion will retry.');
    if (this.busy.has(id)) throw new Error('Verification is stopping; deletion will retry.');
    if (r.tusId) {
      const response = await fetch(`${tusUrl}/files/${encodeURIComponent(r.tusId)}`, {
        method: 'DELETE',
        headers: { 'Tus-Resumable': '1.0.0' },
        signal: AbortSignal.timeout(25000),
      });
      if (![204, 404, 410].includes(response.status))
        throw new Error('Remote deletion failed; cleanup remains pending.');
    }
    this.db.delete(id);
  }
  async reconcile() {
    if (this.reconciling) return;
    this.reconciling = true;
    try {
      for (const r of this.db.all()) {
        try {
          if ((this.active.get(r.id) || 0) > 0) continue;
          if (r.deleting || Date.now() - r.updatedAt > 86400000) {
            await this.remove(r.id);
            continue;
          }
          if (!r.tusId || this.busy.has(r.id)) continue;
          if (r.integrity === 'pending' || r.integrity === 'checking') {
            const response = await fetch(`${tusUrl}/files/${encodeURIComponent(r.tusId)}`, {
              method: 'HEAD',
              headers: { 'Tus-Resumable': '1.0.0' },
              signal: AbortSignal.timeout(25000),
            });
            if (!response.ok) continue;
            const offset = Number(response.headers.get('upload-offset'));
            this.db.patch(r.id, {
              offset,
              ...(offset !== r.offset ? { updatedAt: Date.now() } : {}),
            });
            if (offset === r.size) await this.verify(r.id);
          } else if (
            r.integrity === 'verified' &&
            scanRequired &&
            ['not_run', 'pending'].includes(r.scan)
          )
            await this.verify(r.id);
        } catch {
          /* A transient service outage must not stop reconciliation of other files. */
        }
      }
    } finally {
      this.reconciling = false;
    }
  }
}
