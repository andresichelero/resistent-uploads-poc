export const MAX_SIZE = 100 * 1024 * 1024;
export const CHUNK_SIZE = 8 * 1024 * 1024;
export type Integrity = 'pending' | 'checking' | 'verified' | 'mismatch' | 'error';
export type Scan = 'not_run' | 'pending' | 'clean' | 'detected' | 'inconclusive' | 'error';
export interface UploadInput { name: string; size: number; sha256: string }
export interface UploadRecord extends UploadInput {
  id: string; tusId: string | null; offset: number; createdAt: number; updatedAt: number;
  integrity: Integrity; actualSha256: string | null; scan: Scan;
  scannerVersion: string | null; detail: string | null; deleting: boolean;
}
export interface PublicUpload extends UploadRecord { downloadable: boolean; url: string | null }
