import { describe, it, expect } from 'vitest';
import { HealthController } from './health.controller';

describe('HealthController', () => {
  it('GET /health returns { status: "ok" }', () => {
    const controller = new HealthController();
    expect(controller.check()).toEqual({ status: 'ok' });
  });
});
