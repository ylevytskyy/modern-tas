import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { ScreenPop } from '@/components/ScreenPop';
import { MessageForm } from '@/components/MessageForm';
import type { WsIncomingCallPayload } from '@tas/shared-types';

const sampleCall: WsIncomingCallPayload = {
  type: 'incoming_call',
  callId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  tenantId: '11111111-1111-1111-1111-111111111111',
  accountId: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
  callerE164: '+15555550100',
};

describe('Playwright data-testid contract', () => {
  it('ScreenPop renders [data-testid="screen-pop"][data-call-id=callId] when a call is active', () => {
    const { getByTestId } = render(
      <ScreenPop call={sampleCall} accepted={false} paused={false} onAccept={() => {}} onDecline={() => {}} onPciToggle={() => {}} />,
    );
    const el = getByTestId('screen-pop');
    expect(el.getAttribute('data-call-id')).toBe(sampleCall.callId);
  });

  it('ScreenPop renders [data-testid="accept-call"] when call is not accepted', () => {
    const { getByTestId } = render(
      <ScreenPop call={sampleCall} accepted={false} paused={false} onAccept={() => {}} onDecline={() => {}} onPciToggle={() => {}} />,
    );
    expect(getByTestId('accept-call')).toBeTruthy();
  });

  it('MessageForm renders [data-testid="message-textarea"] and [data-testid="message-submit"]', () => {
    const { getByTestId } = render(<MessageForm onSubmit={() => {}} disabled={false} />);
    expect(getByTestId('message-textarea').tagName).toBe('TEXTAREA');
    expect(getByTestId('message-submit').tagName).toBe('BUTTON');
  });
});
