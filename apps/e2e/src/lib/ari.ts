import { fetch } from 'undici';

const ariBase = process.env.E2E_ARI_BASE ?? 'http://localhost:8088/ari';
const auth = 'Basic ' + Buffer.from('tas:tas').toString('base64');

export interface AriChannel {
  id: string;
  name: string;
  state: string;
  caller: { number: string; name: string };
  channelvars?: Record<string, string>;
}

export async function listChannels(): Promise<AriChannel[]> {
  const res = await fetch(`${ariBase}/channels`, { headers: { Authorization: auth } });
  if (!res.ok) throw new Error(`ARI /channels returned ${res.status}`);
  return (await res.json()) as AriChannel[];
}
