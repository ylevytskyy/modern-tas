import { Client, Connection, WorkflowNotFoundError } from '@temporalio/client';

const address = process.env.E2E_TEMPORAL_ADDRESS ?? 'localhost:7233';

let _client: Client | null = null;

async function getClient(): Promise<Client> {
  if (!_client) {
    const conn = await Connection.connect({ address });
    _client = new Client({ connection: conn });
  }
  return _client;
}

export async function waitForWorkflowCompletion(
  workflowId: string,
  timeoutMs: number,
): Promise<{ status: string }> {
  const client = await getClient();
  const handle = client.workflow.getHandle(workflowId);
  const deadline = Date.now() + timeoutMs;

  const terminalFailures = new Set(['FAILED', 'TERMINATED', 'CANCELLED', 'TIMED_OUT']);
  while (Date.now() < deadline) {
    try {
      const desc = await handle.describe();
      const statusName = desc.status.name;
      if (statusName === 'COMPLETED') return { status: statusName };
      if (terminalFailures.has(statusName)) {
        throw new Error(`workflow ${workflowId} ended in ${statusName}`);
      }
    } catch (err) {
      if (!(err instanceof WorkflowNotFoundError)) throw err;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`workflow ${workflowId} did not complete within ${timeoutMs}ms`);
}
