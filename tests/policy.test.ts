import { describe, expect, it } from 'vitest';
import { canDownload, validateInput, classifyScan } from '../server/policy';
import { TransferRate } from '../shared/rate';

describe('download policy', () => {
  it('never treats an unavailable scanner as a clean verdict', () => {
    expect(canDownload('verified', 'error', true)).toBe(false);
    expect(canDownload('verified', 'inconclusive', true)).toBe(false);
    expect(canDownload('verified', 'clean', true)).toBe(true);
    expect(canDownload('mismatch', 'clean', true)).toBe(false);
    expect(canDownload('verified', 'not_run', false)).toBe(true);
    expect(canDownload('verified', 'detected', false)).toBe(false);
  });
  it('distinguishes detections from limits and encrypted containers', () => {
    expect(classifyScan('stream: OK')).toBe('clean');
    expect(classifyScan('stream: Win.Test.EICAR_HDB-1 FOUND')).toBe('detected');
    expect(classifyScan('stream: Heuristics.Limits.Exceeded.MaxFileSize FOUND')).toBe(
      'inconclusive',
    );
    expect(classifyScan('stream: Heuristics.Encrypted.Zip FOUND')).toBe('inconclusive');
    expect(classifyScan('INSTREAM size limit exceeded. ERROR')).toBe('error');
    expect(classifyScan('unexpected response')).toBe('error');
  });
});
describe('upload input', () => {
  const valid = { name: 'field-recording.wav', size: 123, sha256: 'a'.repeat(64) };
  it('accepts empty files but rejects invalid lengths and hashes', () => {
    expect(validateInput({ ...valid, size: 0 })).toEqual({ ...valid, size: 0 });
    for (const size of [-1, 0.5, 104857601, Infinity])
      expect(() => validateInput({ ...valid, size })).toThrow();
    expect(() => validateInput({ ...valid, sha256: 'not a hash' })).toThrow();
  });
  it('rejects unsafe display names', () => {
    for (const name of ['../file', 'a\\b', 'a\r\nb', '', 'a:b'])
      expect(() => validateInput({ ...valid, name })).toThrow();
  });
});
describe('transfer estimate', () => {
  it('uses elapsed samples, forgets stale speed and resets across resume', () => {
    const rate = new TransferRate();
    rate.add(0, 0);
    rate.add(1000, 1000);
    rate.add(2000, 2000);
    expect(rate.estimate(4000, 2000)).toEqual({ bytesPerSecond: 1000, seconds: 2 });
    expect(rate.estimate(4000, 8000).seconds).toBeNull();
    rate.reset();
    rate.add(2000, 9000);
    expect(rate.estimate(4000, 9000).seconds).toBeNull();
  });
  it('resets when confirmed position moves backwards', () => {
    const rate = new TransferRate();
    rate.add(1000, 0);
    rate.add(2000, 1000);
    rate.add(500, 1500);
    expect(rate.estimate(4000, 1500).seconds).toBeNull();
  });
});
