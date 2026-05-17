import { describe, it, expect, vi, beforeEach } from 'vitest';

const { spawnMock } = vi.hoisted(() => {
  const spawnMock = vi.fn(() => ({
    on(event: string, cb: (code: number) => void) {
      if (event === 'close') queueMicrotask(() => cb(1));   // SIPp returns 1 on "Failed call: 1"
      return this;
    },
    stdout: { on: vi.fn() },
    stderr: { on: vi.fn() },
  }));
  return { spawnMock };
});

vi.mock('node:child_process', () => ({ spawn: spawnMock }));

import { runScenario } from '../src/run-scenario.js';

describe('runScenario argv shape', () => {
  beforeEach(() => spawnMock.mockClear());

  it('invokes docker compose with the scenario file and -key field0 <callId>', async () => {
    const callId = '11111111-2222-3333-4444-555555555555';
    const result = await runScenario({ scenario: 'happy-path', callId });

    expect(spawnMock).toHaveBeenCalledTimes(1);
    const call = spawnMock.mock.calls[0] as unknown as [string, string[]];
    const cmd = call[0];
    const args = call[1];
    expect(cmd).toBe('docker');
    expect(args).toContain('compose');
    expect(args).toContain('-f');
    expect(args.some((a: string) => a.endsWith('docker-compose.sipp.yml'))).toBe(true);
    expect(args).toContain('run');
    expect(args).toContain('--rm');
    expect(args).toContain('sipp');
    expect(args).toContain('-sf');
    expect(args.some((a: string) => a.endsWith('/scenarios/happy-path.xml'))).toBe(true);
    expect(args).toContain('-key');
    expect(args).toContain('callid');
    expect(args).toContain(callId);
    expect(result.callId).toBe(callId);
    expect(result.exitCode).toBe(1);
  });
});
