export interface PostMessageBody {
  callId: string;
  accountId: string;
  operatorId: string;
  body: string;
}

export interface PostMessageResult {
  id: string;
  createdAt: string;
}

export interface PostMessageDeps {
  apiBaseUrl: string;
  token: string;
  body: PostMessageBody;
  fetch?: typeof fetch;
}

export async function postMessage(deps: PostMessageDeps): Promise<PostMessageResult> {
  const fetchImpl = deps.fetch ?? globalThis.fetch;
  const res = await fetchImpl(`${deps.apiBaseUrl}/v1/Message`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${deps.token}`,
    },
    body: JSON.stringify(deps.body),
  });
  if (!res.ok) throw new Error(`/v1/Message returned ${res.status}`);
  return (await res.json()) as PostMessageResult;
}
