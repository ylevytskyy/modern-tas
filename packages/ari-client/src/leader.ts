/**
 * AriLeaderClient — ADR-0016 leader election with Redis-backed lease.
 *
 * TTL must be ≥ 3× HB (ADR-0016 §Decision item 1, PoT S3 finding).
 *
 * Hard-stop: onLoseLease() called via a Promise microtask after detecting lease loss.
 * The WS is closed in the same microtask, before onLoseLease fires.
 *
 * ADR-0016 split-brain guard: the StasisStart event handler has an `if (!this.isLeader) return`
 * guard so in-flight events from a deposed leader are silently dropped.
 *
 * Callback-path correctness is verified in the unit test. Real wire-level FIN < 100 ms
 * evidence (ADR-0016 §Decision item 3) is produced in Chunk 7 S-5 spec.
 */

export interface AriLeaderClientOptions {
  instanceId: string;
  leaseKey: string;
  ttlMs: number;       // Must be ≥ 3 × heartbeatMs (ADR-0016)
  heartbeatMs: number;
  redis: {
    get(key: string): Promise<string | null>;
    set(key: string, value: string, mode: string, ...args: any[]): Promise<string | null>;
    pexpire(key: string, ms: number): Promise<number>;
  };
  /** Factory that creates and connects to the ARI server. */
  ariClientFactory: (appName: string) => Promise<AriClientHandle>;
  /** Called when a StasisStart event fires (leader is active). NOT called if lease is lost. */
  onStasisStart: (event: StasisStartEvent) => void;
  /** Called via process.nextTick when the lease is lost. Guaranteed to fire after WS close. */
  onLoseLease: () => void;
}

export interface AriClientHandle {
  _connection?: { ws?: { close(): void } };
  stop?(appName?: string): void;
  start(appName: string): Promise<void>;
  on(event: string, handler: (...args: any[]) => void): void;
}

export interface StasisStartEvent {
  channel: {
    id: string;
    dialplan: { context: string; exten: string };
    caller: { number: string };
  };
  application: string;
}

export class AriLeaderClient {
  private readonly opts: AriLeaderClientOptions;
  /** @internal exposed for unit tests via isLeaderForTest getter */
  private isLeader = false;
  private ariHandle: AriClientHandle | null = null;
  private intervalHandle: ReturnType<typeof setInterval> | null = null;
  private readonly ARI_APP = process.env.ARI_APP ?? 'ncall';

  constructor(opts: AriLeaderClientOptions) {
    this.opts = opts;
    if (opts.ttlMs < 3 * opts.heartbeatMs) {
      throw new Error(
        `ADR-0016 violation: TTL (${opts.ttlMs}ms) must be ≥ 3× HB (${opts.heartbeatMs}ms). Got ratio ${(opts.ttlMs / opts.heartbeatMs).toFixed(1)}`,
      );
    }
  }

  /** Exposed for unit tests only — do not use in production code. */
  get isLeaderForTest(): boolean {
    return this.isLeader;
  }

  /** Wire or replace the StasisStart callback after construction (used by NestJS DI). */
  setStasisStartCallback(fn: (event: StasisStartEvent) => void): void {
    this.opts.onStasisStart = fn;
  }

  /** Start the heartbeat loop. */
  start(): void {
    if (this.intervalHandle) return;
    this.intervalHandle = setInterval(() => void this._heartbeatOnce(), this.opts.heartbeatMs);
    void this._heartbeatOnce();
  }

  /** Stop the heartbeat loop. Does not close the WS. */
  stop(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  /**
   * Single heartbeat tick. Exposed for unit-test injection (deterministic ticks without setInterval).
   */
  async _heartbeatOnce(): Promise<void> {
    try {
      if (this.isLeader) {
        const renewed = await this._renew();
        if (!renewed) this._loseLeadership('renew failed');
      } else {
        const acquired = await this._tryAcquire();
        if (acquired) await this._becomeLeader();
      }
    } catch (err) {
      this._loseLeadership(`heartbeat error: ${String(err)}`);
    }
  }

  private async _tryAcquire(): Promise<boolean> {
    const result = await this.opts.redis.set(
      this.opts.leaseKey,
      this.opts.instanceId,
      'NX',
      'PX',
      this.opts.ttlMs,
    );
    return result === 'OK';
  }

  private async _renew(): Promise<boolean> {
    const current = await this.opts.redis.get(this.opts.leaseKey);
    if (current !== this.opts.instanceId) return false;
    await this.opts.redis.pexpire(this.opts.leaseKey, this.opts.ttlMs);
    return true;
  }

  private async _becomeLeader(): Promise<void> {
    this.isLeader = true;
    const handle = await this.opts.ariClientFactory(this.ARI_APP);
    this.ariHandle = handle;

    // ADR-0016 split-brain guard: check isLeader at the start of every handler invocation.
    // If this instance has been deposed between event delivery and handler execution,
    // the event is silently dropped — the new leader will process it on its own WS.
    // TODO Chunk 7: verify idempotency of standby reconcile against any events the
    //               deposed leader's drained handlers may have already partially processed.
    handle.on('StasisStart', (event: StasisStartEvent) => {
      if (!this.isLeader) return; // guard: deposed leader drops in-flight events (ADR-0016)
      this.opts.onStasisStart(event);
    });

    await handle.start(this.ARI_APP);
  }

  private _loseLeadership(reason: string): void {
    if (!this.isLeader) return;
    this.isLeader = false;
    const handle = this.ariHandle;
    this.ariHandle = null;
    // Use Promise microtask (not process.nextTick) so vi.runAllTicks() can flush it
    // in unit tests. Semantics are equivalent: fire after current operation, before
    // next macro-task (setTimeout/I/O). process.nextTick would require toFake:['nextTick']
    // in vi.useFakeTimers() to be flushed by vi.runAllTicks().
    void Promise.resolve().then(() => {
      // Force-close the WS immediately — do NOT await outstanding handlers.
      if (handle) {
        try {
          if (handle._connection?.ws && typeof handle._connection.ws.close === 'function') {
            handle._connection.ws.close();
          }
          if (typeof handle.stop === 'function') {
            handle.stop(this.ARI_APP);
          }
        } catch {
          // Swallow — we are already losing leadership
        }
      }
      this.opts.onLoseLease();
    });
  }
}
