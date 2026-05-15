import { proxyActivities } from '@temporalio/workflow';
import type * as activities from './activities.js';

const { sayHello } = proxyActivities<typeof activities>({
  startToCloseTimeout: '10 seconds',
});

export async function HelloWorldWorkflow(name: string): Promise<string> {
  return await sayHello(name);
}
