import { createConnection } from 'node:net';
import { once } from 'node:events';
import type { Readable } from 'node:stream';
import { classifyScan } from './policy.ts';
import type { Scan } from '../shared/types.ts';
const host = process.env.CLAM_HOST || '127.0.0.1';
export async function scannerVersion(): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host, port: 3310 });
    let result = '';
    socket.setTimeout(5000, () => socket.destroy(new Error('Scanner version timeout')));
    socket.on('error', reject);
    socket.on('connect', () => socket.write('zVERSION\0'));
    socket.on('data', data => { result += data.toString(); if (result.includes('\0')) { socket.destroy(); resolve(result.replace(/\0/g, '').trim()); } });
    socket.on('end', () => resolve(result.trim()));
  });
}
export async function scanStream(stream: Readable): Promise<{ scan: Scan; detail: string }> {
  const socket = createConnection({ host, port: 3310 });
  let response = '';
  const verdict = new Promise<string>((resolve, reject) => {
    socket.on('error', reject);
    socket.on('data', data => { response += data.toString(); if (response.includes('\0')) resolve(response.replace(/\0/g, '').trim()); });
    socket.on('end', () => resolve(response.trim()));
  });
  // Handle early socket errors even while the producer is still streaming.
  void verdict.catch(() => undefined);
  const deadline = setTimeout(() => { socket.destroy(new Error('Scanner exceeded 120 seconds')); stream.destroy(new Error('Scan timeout')); }, 120000);
  try {
    await once(socket, 'connect'); socket.write('zINSTREAM\0');
    for await (const chunk of stream) {
      const body = Buffer.from(chunk); const length = Buffer.alloc(4); length.writeUInt32BE(body.length);
      if (!socket.write(Buffer.concat([length, body]))) await once(socket, 'drain');
    }
    socket.write(Buffer.alloc(4));
    const detail = await verdict;
    return { scan: classifyScan(detail), detail };
  } finally { clearTimeout(deadline); socket.destroy(); stream.destroy(); }
}
