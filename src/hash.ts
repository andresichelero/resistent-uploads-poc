export function hashFile(file: Blob, progress?: (bytes: number) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./hash.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }) => {
      if (data.error) { worker.terminate(); reject(new Error(data.error)); }
      else if (data.digest) { worker.terminate(); resolve(data.digest); }
      else progress?.(data.progress);
    };
    worker.onerror = () => { worker.terminate(); reject(new Error('File hashing failed.')); };
    worker.postMessage(file);
  });
}
