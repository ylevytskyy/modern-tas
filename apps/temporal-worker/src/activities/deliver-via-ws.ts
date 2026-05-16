export interface DeliverViaWsInput {
  messageId: string;
  operatorId: string;
  payload: unknown;
}

export interface DeliverViaWsOutput {
  delivered: boolean;
}

export interface DeliverViaWsDeps {
  apiBaseUrl: string;
  internalToken: string;
  fetch?: typeof fetch;
}

export function makeDeliverViaWs(deps: DeliverViaWsDeps) {
  const fetchImpl = deps.fetch ?? globalThis.fetch;
  return async function deliverViaWs(input: DeliverViaWsInput): Promise<DeliverViaWsOutput> {
    const res = await fetchImpl(`${deps.apiBaseUrl}/internal/dispatch-deliver`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Token': deps.internalToken,
      },
      body: JSON.stringify(input),
    });
    if (!res.ok) throw new Error(`dispatch-deliver returned ${res.status}`);
    return (await res.json()) as DeliverViaWsOutput;
  };
}
