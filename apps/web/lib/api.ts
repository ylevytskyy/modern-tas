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

export interface PauseCallDeps {
  apiBaseUrl: string;
  token: string;
  callId: string;
  fetch?: typeof fetch;
}

export async function pauseCall(deps: PauseCallDeps): Promise<void> {
  const fetchImpl = deps.fetch ?? globalThis.fetch;
  const res = await fetchImpl(`${deps.apiBaseUrl}/v1/calls/${deps.callId}/pause`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${deps.token}`,
    },
  });
  if (!res.ok) throw new Error(`/v1/calls/${deps.callId}/pause returned ${res.status}`);
}

export interface ResumeCallDeps {
  apiBaseUrl: string;
  token: string;
  callId: string;
  fetch?: typeof fetch;
}

export async function resumeCall(deps: ResumeCallDeps): Promise<void> {
  const fetchImpl = deps.fetch ?? globalThis.fetch;
  const res = await fetchImpl(`${deps.apiBaseUrl}/v1/calls/${deps.callId}/resume`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${deps.token}`,
    },
  });
  if (!res.ok) throw new Error(`/v1/calls/${deps.callId}/resume returned ${res.status}`);
}
