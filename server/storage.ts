import { S3Client, GetObjectCommand, HeadBucketCommand } from '@aws-sdk/client-s3';
import type { Readable } from 'node:stream';
export const bucket = process.env.S3_BUCKET || 'uploads';
export const s3 = new S3Client({ endpoint: process.env.S3_ENDPOINT, region: process.env.AWS_REGION || 'us-east-1', forcePathStyle: !!process.env.S3_ENDPOINT });
export const storageHealthy = () => s3.send(new HeadBucketCommand({ Bucket: bucket }), { abortSignal: AbortSignal.timeout(3000) });
export async function objectStream(tusId: string) {
  // tusd S3 identifiers are <object key>+<multipart ID>. The key is not the whole URL.
  const result = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: tusId.split('+')[0] }), { abortSignal: AbortSignal.timeout(150000) });
  if (!result.Body) throw new Error('Storage returned no body');
  return { stream: result.Body as Readable, length: result.ContentLength };
}
