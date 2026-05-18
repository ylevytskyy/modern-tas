import { NativeConnection, Worker } from '@temporalio/worker';
import { Client, Connection } from '@temporalio/client';
import { WorkflowNotFoundError } from '@temporalio/common';
import { connect, StringCodec } from 'nats';
import { makeDb } from '@tas/db/client';
import { message as messageTable } from '@tas/db';
import { eq } from 'drizzle-orm';
import { makeDeliverViaWs } from './activities/deliver-via-ws';
import { makeMarkDelivered } from './activities/mark-delivered';
import { makeMarkFailed } from './activities/mark-failed';
import { callEndedSignal } from './workflows/dispatch-message';
import { NatsSubjects } from '@tas/shared-types';
import type { NatsCallEndedPayload } from '@tas/shared-types';

const sc = StringCodec();

async function main(): Promise<void> {
  const temporalAddress = process.env.TEMPORAL_ADDRESS ?? 'localhost:7233';
  const namespace = process.env.TEMPORAL_NAMESPACE ?? 'default';
  const apiBaseUrl = process.env.API_BASE_URL ?? 'http://localhost:3000';
  const internalToken = process.env.INTERNAL_API_TOKEN;
  const dbUrl = process.env.DATABASE_URL;
  const natsUrl = process.env.NATS_URL ?? 'nats://localhost:4222';

  if (!internalToken) throw new Error('INTERNAL_API_TOKEN env required');
  if (!dbUrl) throw new Error('DATABASE_URL env required');

  const nativeConnection = await NativeConnection.connect({ address: temporalAddress });
  const clientConnection = await Connection.connect({ address: temporalAddress });
  const temporalClient = new Client({ connection: clientConnection, namespace });
  const db = makeDb(dbUrl);

  const worker = await Worker.create({
    connection: nativeConnection,
    namespace,
    taskQueue: 'dispatch-message',
    workflowsPath: require.resolve('./workflows/dispatch-message'),
    activities: {
      deliverViaWs: makeDeliverViaWs({ apiBaseUrl, internalToken }),
      markDelivered: makeMarkDelivered(db),
      markFailed: makeMarkFailed(db),
    },
  });

  // Subscribe to tas.call.ended — signal any in-flight DispatchMessage workflow.
  // Mapping: look up message rows for the callId, derive workflowId = dispatch-${messageId}.
  const nc = await connect({ servers: natsUrl });
  const sub = nc.subscribe(NatsSubjects.CALL_ENDED);

  (async () => {
    for await (const msg of sub) {
      try {
        const payload = JSON.parse(sc.decode(msg.data)) as NatsCallEndedPayload;
        const { callId } = payload;

        // Find all messages for this call (normally exactly one in the PoC).
        const rows = await db
          .select({ id: messageTable.id })
          .from(messageTable)
          .where(eq(messageTable.callId, callId));

        for (const row of rows) {
          const workflowId = `dispatch-${row.id}`;
          try {
            const handle = temporalClient.workflow.getHandle(workflowId);
            await handle.signal(callEndedSignal);
            console.log(`worker: sent callEnded signal → ${workflowId}`);
          } catch (err: unknown) {
            // Workflow may have already completed — not an error in that case.
            if (!(err instanceof WorkflowNotFoundError)) {
              console.error(`worker: failed to signal ${workflowId}`, err);
            }
          }
        }
      } catch (err) {
        console.error('worker: error processing tas.call.ended', err);
      }
    }
  })().catch((err) => console.error('worker: NATS subscription error', err));

  console.log(`worker: ready taskQueue=dispatch-message namespace=${namespace} address=${temporalAddress}`);

  try {
    await worker.run();
  } finally {
    sub.unsubscribe();
    await nc.drain().catch((e) => console.error('worker: NATS drain error', e));
    clientConnection.close();
  }
}

main().catch((err) => {
  console.error('worker: fatal', err);
  process.exit(1);
});
