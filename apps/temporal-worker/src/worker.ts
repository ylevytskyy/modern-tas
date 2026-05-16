import { NativeConnection, Worker } from '@temporalio/worker';
import { makeDb } from '@tas/db/client';
import { makeDeliverViaWs } from './activities/deliver-via-ws';
import { makeMarkDelivered } from './activities/mark-delivered';

async function main(): Promise<void> {
  const temporalAddress = process.env.TEMPORAL_ADDRESS ?? 'localhost:7233';
  const namespace = process.env.TEMPORAL_NAMESPACE ?? 'default';
  const apiBaseUrl = process.env.API_BASE_URL ?? 'http://localhost:3000';
  const internalToken = process.env.INTERNAL_API_TOKEN;
  const dbUrl = process.env.DATABASE_URL;

  if (!internalToken) throw new Error('INTERNAL_API_TOKEN env required');
  if (!dbUrl) throw new Error('DATABASE_URL env required');

  const connection = await NativeConnection.connect({ address: temporalAddress });
  const db = makeDb(dbUrl);

  const worker = await Worker.create({
    connection,
    namespace,
    taskQueue: 'dispatch-message',
    workflowsPath: require.resolve('./workflows/dispatch-message'),
    activities: {
      deliverViaWs: makeDeliverViaWs({ apiBaseUrl, internalToken }),
      markDelivered: makeMarkDelivered(db),
    },
  });

  console.log(`worker: ready taskQueue=dispatch-message namespace=${namespace} address=${temporalAddress}`);
  await worker.run();
}

main().catch((err) => {
  console.error('worker: fatal', err);
  process.exit(1);
});
