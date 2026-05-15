import { Client, Connection } from '@temporalio/client';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { HelloWorldWorkflow } from './workflows.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(
  readFileSync(join(__dirname, '../config/selfhost.json'), 'utf-8'),
);

async function main() {
  const connection = await Connection.connect({ address: config.address });
  try {
    const client = new Client({ connection, namespace: config.namespace });
    const workflowId = `hello-${Date.now()}`;
    const handle = await client.workflow.start(HelloWorldWorkflow, {
      args: ['world'],
      taskQueue: 'hello-baseline',
      workflowId,
    });
    console.log(`Started workflow ${workflowId}`);
    const result = await handle.result();
    console.log(`Result: ${result}`);
  } finally {
    await connection.close();
  }
}

main().catch((err) => {
  console.error('Trigger failed:', err);
  process.exit(1);
});
