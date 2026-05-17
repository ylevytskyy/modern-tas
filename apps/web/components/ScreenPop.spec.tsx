import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { WsIncomingCallPayload } from '@tas/shared-types';
import { ScreenPop } from './ScreenPop';

const PAYLOAD: WsIncomingCallPayload = {
  type: 'incoming_call',
  callId: 'c-1',
  tenantId: 't-1',
  accountId: 'a-1',
  callerE164: '+15555550100',
};

describe('ScreenPop', () => {
  it('renders the caller E.164 and call id', () => {
    render(<ScreenPop call={PAYLOAD} onAccept={() => {}} onPciToggle={() => {}} accepted={false} paused={false} />);
    expect(screen.getByText(/\+15555550100/)).toBeInTheDocument();
    expect(screen.getByText(/c-1/)).toBeInTheDocument();
  });

  it('fires onAccept when the Accept button is clicked', async () => {
    let accepted = false;
    render(<ScreenPop
      call={PAYLOAD}
      onAccept={() => { accepted = true; }}
      onPciToggle={() => {}}
      accepted={false}
      paused={false}
    />);
    await userEvent.click(screen.getByRole('button', { name: /accept/i }));
    expect(accepted).toBe(true);
  });

  it('fires onPciToggle when the PCI pause button is clicked', async () => {
    let toggled = false;
    render(<ScreenPop
      call={PAYLOAD}
      onAccept={() => {}}
      onPciToggle={() => { toggled = true; }}
      accepted={true}
      paused={false}
    />);
    await userEvent.click(screen.getByRole('button', { name: /pci pause/i }));
    expect(toggled).toBe(true);
  });

  it('shows a Paused badge when paused=true', () => {
    render(<ScreenPop
      call={PAYLOAD}
      onAccept={() => {}}
      onPciToggle={() => {}}
      accepted={true}
      paused={true}
    />);
    expect(screen.getByText(/paused/i)).toBeInTheDocument();
  });

  it('renders an empty/idle state when call is null', () => {
    render(<ScreenPop call={null} onAccept={() => {}} onPciToggle={() => {}} accepted={false} paused={false} />);
    expect(screen.getByText(/waiting for call/i)).toBeInTheDocument();
  });
});
