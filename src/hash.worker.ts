import { createSHA256 } from 'hash-wasm';
self.onmessage = async ({ data }: MessageEvent<Blob>) => {
  try {
    const hash = await createSHA256(); hash.init();
    for (let offset = 0; offset < data.size; offset += 1024 * 1024) {
      hash.update(new Uint8Array(await data.slice(offset, offset + 1024 * 1024).arrayBuffer()));
      self.postMessage({ progress: Math.min(data.size, offset + 1024 * 1024) });
    }
    self.postMessage({ digest: hash.digest('hex') });
  } catch { self.postMessage({ error: 'Could not read the selected file.' }); }
};
