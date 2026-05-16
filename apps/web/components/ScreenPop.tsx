'use client';
import type { WsIncomingCallPayload } from '@tas/shared-types';

export interface ScreenPopProps {
  call: WsIncomingCallPayload | null;
  accepted: boolean;
  paused: boolean;
  onAccept: () => void;
  onPciToggle: () => void;
}

export function ScreenPop(props: ScreenPopProps) {
  if (!props.call) {
    return <section aria-label="screen-pop"><p>Waiting for call…</p></section>;
  }
  const { call, accepted, paused, onAccept, onPciToggle } = props;
  return (
    <section aria-label="screen-pop">
      <h2>Incoming call</h2>
      <dl>
        <dt>From</dt><dd>{call.callerE164}</dd>
        <dt>Call ID</dt><dd>{call.callId}</dd>
      </dl>
      {!accepted && <button onClick={onAccept}>Accept</button>}
      {accepted && (
        <>
          <button onClick={onPciToggle}>{paused ? 'Resume' : 'PCI pause'}</button>
          {paused && <span role="status">Paused</span>}
        </>
      )}
    </section>
  );
}
