import { MAX_SIZE, type Integrity, type Scan, type UploadInput } from '../shared/types.ts';
export function canDownload(integrity: Integrity, scan: Scan, required: boolean): boolean {
  return integrity === 'verified' && (scan === 'clean' || (!required && scan === 'not_run'));
}
export function classifyScan(response: string): Scan {
  if (/Heuristics\.(Limits\.Exceeded|Encrypted)/.test(response)) return 'inconclusive';
  if (/ FOUND$/.test(response.trim())) return 'detected';
  if (/^stream: OK$/.test(response.trim())) return 'clean';
  return 'error';
}
export function validateInput(value: unknown): UploadInput {
  const v = value as Partial<UploadInput> | null;
  if (!v || typeof v.name !== 'string' || !v.name.trim() || v.name.length > 200 || /[\\/:]/.test(v.name) || [...v.name].some(c => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)) throw new Error('Use a filename without paths or control characters (maximum 200 characters).');
  if (!Number.isSafeInteger(v.size) || v.size! < 0 || v.size! > MAX_SIZE) throw new Error('Files must be between 0 bytes and 100 MiB.');
  if (typeof v.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(v.sha256)) throw new Error('A full SHA-256 digest is required.');
  return { name: v.name, size: v.size!, sha256: v.sha256 };
}
