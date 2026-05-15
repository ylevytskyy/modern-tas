import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const workerPath = join(__dirname, 'worker.ts');
const triggerPath = join(__dirname, 'trigger.ts');

async function main() {
  const worker = spawn('npx', ['tsx', workerPath], { stdio: ['ignore', 'pipe', 'pipe'] });

  try {
    await new Promise<void>((resolve, reject) => {
      let buffered = '';
      const onData = (chunk: Buffer) => {
        const s = chunk.toString();
        process.stdout.write(`[worker] ${s}`);
        buffered += s;
        if (buffered.includes('polling task queue')) resolve();
      };
      worker.stdout?.on('data', onData);
      worker.stderr?.on('data', (chunk) => process.stderr.write(`[worker] ${chunk}`));
      worker.on('exit', (code) => reject(new Error(`worker exited early with code ${code}`)));
      setTimeout(() => reject(new Error('worker did not become ready within 30s')), 30_000);
    });

    await new Promise<void>((resolve, reject) => {
      const trigger = spawn('npx', ['tsx', triggerPath], { stdio: 'inherit' });
      trigger.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`trigger exited ${code}`))));
    });
  } finally {
    // Always shut down the worker — including the case where trigger rejects mid-flight.
    if (worker.exitCode === null) worker.kill('SIGTERM');
  }
}

main().catch((err) => {
  console.error('run-hello failed:', err);
  process.exit(1);
});
