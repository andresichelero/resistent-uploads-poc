import { expect, it } from 'vitest';
import { Records } from '../server/db';
import type { UploadRecord } from '../shared/types';
it('keeps concurrent upload records and patches independently', () => {
  const db = new Records(':memory:');
  const base: UploadRecord = {
    id: 'a',
    name: 'a',
    size: 10,
    sha256: 'a'.repeat(64),
    tusId: null,
    offset: 0,
    createdAt: 1,
    updatedAt: 1,
    integrity: 'pending',
    actualSha256: null,
    scan: 'not_run',
    scannerVersion: null,
    detail: null,
    deleting: false,
  };
  db.put(base);
  db.put({ ...base, id: 'b' });
  db.patch('a', { offset: 5 });
  expect(db.get('a')?.offset).toBe(5);
  expect(db.get('b')?.offset).toBe(0);
  db.delete('a');
  expect(db.all()).toHaveLength(1);
  db.close();
});
