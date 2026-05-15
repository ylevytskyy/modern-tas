import { NativeConnection, Worker } from '@temporalio/worker';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import * as activities from './activities.js';

// Temporal's Worker.create({ workflowsPath }) needs a CommonJS-style require.resolve
// to locate the workflow bundle entrypoint. import.meta.resolve is async + experimental,
// so we synthesise a require() local to this ESM module via createRequire.
const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(
  readFileSync(join(__dirname, '../config/selfhost.json'), 'utf-8'),
);

async function main() {
  const connection = await NativeConnection.connect({ address: config.address });
  try {
    const worker = await Worker.create({
      connection,
      namespace: config.namespace,
      taskQueue: 'hello-baseline',
      workflowsPath: require.resolve('./workflows.js'),
      activities,
    });
    console.log(
      `Worker connected to ${config.address}, namespace="${config.namespace}", polling task queue "hello-baseline"`,
    );
    await worker.run();
  } finally {
    await connection.close();
  }
}

main().catch((err) => {
  console.error('Worker failed:', err);
  process.exit(1);
});
