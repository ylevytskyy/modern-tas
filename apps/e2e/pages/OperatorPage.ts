import type { Page, Response } from '@playwright/test';

export interface SubmitResult {
  status: number;
  body: { id: string; createdAt: string };
}

export class OperatorPage {
  constructor(private readonly page: Page) {}

  async goto(_operatorId: string): Promise<void> {
    // operatorId currently comes from NEXT_PUBLIC_OPERATOR_ID env var on the page;
    // we accept the arg for forward-compat but rely on the env default.
    await this.page.goto('/operator');
  }

  async waitForWsOpen(timeoutMs = 5000): Promise<void> {
    await this.page.waitForSelector('[data-testid="ws-ready"]', { state: 'attached', timeout: timeoutMs });
  }

  async waitForScreenPop(params: { timeoutMs?: number } = {}): Promise<{ callId: string }> {
    const sel = `[data-testid="screen-pop"][data-call-id]`;
    const handle = await this.page.waitForSelector(sel, { state: 'visible', timeout: params.timeoutMs ?? 1000 });
    const callId = await handle.getAttribute('data-call-id');
    if (!callId) throw new Error('screen-pop element rendered without data-call-id');
    return { callId };
  }

  async accept(): Promise<void> {
    await this.page.locator('[data-testid="accept-call"]').click();
  }

  async fillMessage(text: string): Promise<void> {
    await this.page.locator('[data-testid="message-textarea"]').fill(text);
  }

  async submit(): Promise<SubmitResult> {
    const responsePromise = this.page.waitForResponse(
      (r: Response) => r.url().endsWith('/v1/Message') && r.request().method() === 'POST',
      { timeout: 5000 },
    );
    await this.page.locator('[data-testid="message-submit"]').click();
    const res = await responsePromise;
    const body = (await res.json()) as { id: string; createdAt: string };
    return { status: res.status(), body };
  }
}
