import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { UploadRecord } from '../shared/types.ts';
export class Records {
  private db: DatabaseSync;
  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(
      'PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS uploads (id TEXT PRIMARY KEY, value TEXT NOT NULL)',
    );
  }
  get(id: string): UploadRecord | undefined {
    const row = this.db.prepare('SELECT value FROM uploads WHERE id=?').get(id);
    return row ? JSON.parse(row.value as string) : undefined;
  }
  all(): UploadRecord[] {
    return this.db
      .prepare('SELECT value FROM uploads ORDER BY rowid DESC')
      .all()
      .map((r) => JSON.parse(r.value as string));
  }
  put(record: UploadRecord) {
    this.db
      .prepare(
        'INSERT INTO uploads VALUES (?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value',
      )
      .run(record.id, JSON.stringify(record));
  }
  patch(id: string, update: Partial<UploadRecord>) {
    const r = this.get(id);
    if (r) this.put({ ...r, ...update });
  }
  delete(id: string) {
    this.db.prepare('DELETE FROM uploads WHERE id=?').run(id);
  }
  close() {
    this.db.close();
  }
}
