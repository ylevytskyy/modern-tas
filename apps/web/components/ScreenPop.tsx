'use client';
import type { WsIncomingCallPayload, WsCallEndedPayload } from '@tas/shared-types';
import { Banner } from './Banner';

export interface ScreenPopProps {
  call: WsIncomingCallPayload | null;
  accepted: boolean;
  paused: boolean;
  pciPending?: boolean;
  onAccept: () => void;
  onPciToggle: () => void;
  callEnded?: Pick<WsCallEndedPayload, 'endedBy'>;
  onBannerDismiss?: () => void;
}

export function ScreenPop(props: ScreenPopProps) {
  if (!props.call) {
    return <section aria-label="screen-pop"><p>Waiting for call…</p></section>;
  }
  const { call, accepted, paused, pciPending, onAccept, onPciToggle, callEnded, onBannerDismiss } = props;
  return (
    <section aria-label="screen-pop" data-testid="screen-pop" data-call-id={call.callId}>
      {callEnded && (
        <Banner
          variant="warning"
          message={callEnded.endedBy === 'caller' ? 'Caller hung up' : 'Call ended'}
          onDismiss={onBannerDismiss}
        />
      )}
      <h2>Incoming call</h2>
      <dl>
        <dt>From</dt><dd>{call.callerE164}</dd>
        <dt>Call ID</dt><dd>{call.callId}</dd>
      </dl>
      {!callEnded && !accepted && <button onClick={onAccept} data-testid="accept-call">Accept</button>}
      {!callEnded && accepted && (
        <>
          <button onClick={onPciToggle} disabled={!!pciPending}>{paused ? 'Resume' : 'PCI pause'}</button>
          {paused && <span role="status">Paused</span>}
        </>
      )}
    </section>
  );
}
