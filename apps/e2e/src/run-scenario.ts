import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface RunScenarioParams {
  scenario: 'happy-path' | 'caller-hangup' | 'pci-pause' | 's4-decline-reroute';
  callId: string;
  target?: string;     // defaults to asterisk:5060 (Docker DNS in infra_default network)
}

export interface RunScenarioResult {
  callId: string;
  exitCode: number;
  stderr: string;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const composeFile = path.resolve(__dirname, '../docker-compose.sipp.yml');

export async function runScenario(params: RunScenarioParams): Promise<RunScenarioResult> {
  // Default target is `asterisk:5060` — Docker DNS resolves it inside infra_default network.
  // When running outside Docker (e.g. host-side testing), pass --target 127.0.0.1:5060.
  const target = params.target ?? 'asterisk:5060';
  const scenarioPath = `/scenarios/${params.scenario}.xml`;

  return new Promise((resolve, reject) => {
    const args = [
      'compose', '-f', composeFile,
      'run', '--rm', 'sipp',
      '-sf', scenarioPath,
      '-key', 'callid', params.callId,
      '-m', '1', '-r', '1',
      target,
    ];
    const proc = spawn('docker', args);
    let stderr = '';
    proc.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
    proc.on('close', (code: number) => {
      resolve({ callId: params.callId, exitCode: code ?? -1, stderr });
    });
    proc.on('error', (err) => reject(err));
  });
}

// CLI entry — `pnpm --filter @tas/e2e run scenario -- --scenario happy-path --callId <uuid>`
if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2);
  const scenarioIdx = argv.indexOf('--scenario');
  const callIdIdx = argv.indexOf('--callId');
  const targetIdx = argv.indexOf('--target');
  if (scenarioIdx < 0 || callIdIdx < 0) {
    console.error('usage: run-scenario --scenario <name> --callId <uuid> [--target host:port]');
    process.exit(2);
  }
  runScenario({
    scenario: argv[scenarioIdx + 1] as 'happy-path' | 'caller-hangup' | 'pci-pause' | 's4-decline-reroute',
    callId: argv[callIdIdx + 1],
    target: targetIdx >= 0 ? argv[targetIdx + 1] : undefined,
  })
    .then((res) => { console.log(JSON.stringify(res)); process.exit(0); })
    .catch((err) => { console.error(err); process.exit(1); });
}
