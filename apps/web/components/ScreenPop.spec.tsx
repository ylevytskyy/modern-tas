import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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
    render(<ScreenPop call={PAYLOAD} onAccept={() => {}} onDecline={() => {}} onPciToggle={() => {}} accepted={false} paused={false} />);
    expect(screen.getByText(/\+15555550100/)).toBeInTheDocument();
    expect(screen.getByText(/c-1/)).toBeInTheDocument();
  });

  it('fires onAccept when the Accept button is clicked', async () => {
    let accepted = false;
    render(<ScreenPop
      call={PAYLOAD}
      onAccept={() => { accepted = true; }}
      onDecline={() => {}}
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
      onDecline={() => {}}
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
      onDecline={() => {}}
      onPciToggle={() => {}}
      accepted={true}
      paused={true}
    />);
    expect(screen.getByText(/paused/i)).toBeInTheDocument();
  });

  it('renders an empty/idle state when call is null', () => {
    render(<ScreenPop call={null} onAccept={() => {}} onDecline={() => {}} onPciToggle={() => {}} accepted={false} paused={false} />);
    expect(screen.getByText(/waiting for call/i)).toBeInTheDocument();
  });

  it('shows Caller hung up banner and hides Accept on callEnded prop', () => {
    render(
      <ScreenPop
        call={PAYLOAD}
        onAccept={() => {}}
        onDecline={() => {}}
        onPciToggle={() => {}}
        paused={false}
        accepted={false}
        callEnded={{ endedBy: 'caller' }}
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Caller hung up');
    expect(screen.queryByRole('button', { name: /accept/i })).toBeNull();
  });

  it('shows generic Call ended banner when endedBy is operator or system', () => {
    render(
      <ScreenPop
        call={{ callId: 'c1', callerE164: '+15551234567', type: 'incoming_call', tenantId: 't1', accountId: 'a1' }}
        onAccept={() => {}}
        onDecline={() => {}}
        onPciToggle={() => {}}
        paused={false}
        accepted={false}
        callEnded={{ endedBy: 'system' }}
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Call ended');
  });

  it('does not show the banner when callEnded is undefined', () => {
    render(
      <ScreenPop
        call={PAYLOAD}
        onAccept={() => {}}
        onDecline={() => {}}
        onPciToggle={() => {}}
        paused={false}
        accepted={false}
      />,
    );
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('PCI button is disabled when pciPending=true, blocking a second click', async () => {
    let callCount = 0;
    render(
      <ScreenPop
        call={PAYLOAD}
        onAccept={() => {}}
        onDecline={() => {}}
        onPciToggle={() => { callCount++; }}
        accepted={true}
        paused={false}
        pciPending={true}
      />,
    );
    const btn = screen.getByRole('button', { name: /pci pause/i });
    expect(btn).toBeDisabled();
    // userEvent respects the disabled attribute — click is swallowed
    await userEvent.click(btn);
    expect(callCount).toBe(0);
  });

  it('renders a Decline button next to Accept when call is unaccepted', () => {
    const onDecline = vi.fn();
    render(
      <ScreenPop
        call={{ type: 'incoming_call', callId: 'c1', tenantId: 't1', accountId: 'a1', callerE164: '+15551234567' }}
        accepted={false}
        paused={false}
        onAccept={() => {}}
        onDecline={onDecline}
        onPciToggle={() => {}}
      />,
    );
    const button = screen.getByTestId('decline-call');
    expect(button).toBeInTheDocument();
    fireEvent.click(button);
    expect(onDecline).toHaveBeenCalledTimes(1);
  });

  it('hides Decline button after accepted', () => {
    render(
      <ScreenPop
        call={{ type: 'incoming_call', callId: 'c1', tenantId: 't1', accountId: 'a1', callerE164: '+15551234567' }}
        accepted={true}
        paused={false}
        onAccept={() => {}}
        onDecline={() => {}}
        onPciToggle={() => {}}
      />,
    );
    expect(screen.queryByTestId('decline-call')).not.toBeInTheDocument();
  });

  it('disables Decline button when declinePending is true', () => {
    render(
      <ScreenPop
        call={{ type: 'incoming_call', callId: 'c1', tenantId: 't1', accountId: 'a1', callerE164: '+15551234567' }}
        accepted={false}
        paused={false}
        onAccept={() => {}}
        onDecline={() => {}}
        declinePending={true}
        onPciToggle={() => {}}
      />,
    );
    expect(screen.getByTestId('decline-call')).toBeDisabled();
  });
});
