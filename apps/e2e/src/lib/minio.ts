import { Buffer } from 'node:buffer';
import { Client } from 'minio';

const endpoint = process.env.E2E_MINIO_ENDPOINT ?? 'localhost';
const port = parseInt(process.env.E2E_MINIO_PORT ?? '9000', 10);
const useSsl = (process.env.E2E_MINIO_USE_SSL ?? 'false') === 'true';
const accessKey = process.env.E2E_MINIO_ACCESS_KEY ?? 'tas';
const secretKey = process.env.E2E_MINIO_SECRET_KEY ?? 'tas12345';

let _client: Client | null = null;

export function getMinio(): Client {
  if (!_client) _client = new Client({ endPoint: endpoint, port, useSSL: useSsl, accessKey, secretKey });
  return _client;
}

export async function objectExists(bucket: string, key: string): Promise<boolean> {
  try {
    await getMinio().statObject(bucket, key);
    return true;
  } catch (err: any) {
    if (err.code === 'NotFound' || err.code === 'NoSuchKey') return false;
    throw err;
  }
}

export async function downloadObject(bucket: string, key: string): Promise<Buffer> {
  const stream = await getMinio().getObject(bucket, key);
  const chunks: Buffer[] = [];
  for await (const chunk of stream as AsyncIterable<Buffer>) chunks.push(chunk);
  return Buffer.concat(chunks);
}
