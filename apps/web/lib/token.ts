export interface TokenFetcherDeps {
  apiBaseUrl: string;
  operatorId: string;
  fetch?: typeof fetch;
}

export async function fetchOperatorToken(deps: TokenFetcherDeps): Promise<string> {
  const fetchImpl = deps.fetch ?? globalThis.fetch;
  const res = await fetchImpl(
    `${deps.apiBaseUrl}/v1/dev/operator-token?operatorId=${encodeURIComponent(deps.operatorId)}`,
  );
  if (!res.ok) throw new Error(`token endpoint returned ${res.status}`);
  const body = (await res.json()) as { token: string };
  return body.token;
}
