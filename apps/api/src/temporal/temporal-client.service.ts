import { Inject, Injectable } from '@nestjs/common';
import type { Client, WorkflowStartOptions } from '@temporalio/client';
import { TEMPORAL_CLIENT_TOKEN } from './temporal.tokens';

@Injectable()
export class TemporalClientService {
  constructor(@Inject(TEMPORAL_CLIENT_TOKEN) private readonly client: Client) {}

  async start(
    workflowType: string,
    opts: WorkflowStartOptions,
  ): Promise<{ workflowId: string }> {
    const handle = await this.client.workflow.start(workflowType, opts);
    return { workflowId: handle.workflowId };
  }
}
