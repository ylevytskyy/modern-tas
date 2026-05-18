'use client';
import { useCallback, useEffect, useState } from 'react';
import type { WsIncomingCallPayload, WsCallEndedPayload } from '@tas/shared-types';
import { ScreenPop } from '@/components/ScreenPop';
import { Banner } from '@/components/Banner';
import { MessageForm } from '@/components/MessageForm';
import { createWsClient } from '@/lib/ws';
import { fetchOperatorToken } from '@/lib/token';
import { pauseCall, resumeCall, postMessage } from '@/lib/api';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3000';
const WS_URL       = process.env.NEXT_PUBLIC_WS_URL ?? 'ws://localhost:3000/ws';
const OPERATOR_ID  = process.env.NEXT_PUBLIC_OPERATOR_ID ?? '66666666-6666-6666-6666-666666666666';

export default function OperatorPage() {
  const [token, setToken] = useState<string | null>(null);
  const [call, setCall] = useState<WsIncomingCallPayload | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [paused, setPaused] = useState(false);
  const [isPciPending, setIsPciPending] = useState(false);
  const [wsReady, setWsReady] = useState(false);
  const [callEnded, setCallEnded] = useState<WsCallEndedPayload | undefined>(undefined);
  const [declinePending, setDeclinePending] = useState(false);
  const [declineError, setDeclineError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetchOperatorToken({ apiBaseUrl: API_BASE_URL, operatorId: OPERATOR_ID })
      .then((t) => { if (active) setToken(t); })
      .catch((err) => console.error('token fetch failed', err));
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!token) return;
    const client = createWsClient({ url: WS_URL, token });

    client.onOpen(() => setWsReady(true));
    client.onScreenPop((payload) => {
      setCall(payload);
      setAccepted(false);
      setPaused(false);
      setCallEnded(undefined);
    });
    client.onCallEnded((payload) => {
      setCallEnded(payload);
    });
    return () => {
      client.close();
    };
  }, [token]);

  const onDecline = useCallback(async () => {
    if (!call) return;
    if (declinePending) return;
    setDeclinePending(true);
    setDeclineError(null);
    try {
      const res = await fetch(`${API_BASE_URL}/v1/calls/${call.callId}/decline`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ message: 'decline failed' }));
        setDeclineError(body.message ?? `HTTP ${res.status}`);
        return;
      }
      // Optimistic close — clear local screen-pop state.
      setCall(null);
    } catch (err) {
      setDeclineError((err as Error).message);
    } finally {
      setDeclinePending(false);
    }
  }, [call, token, declinePending]);

  async function submitMessage(body: string): Promise<void> {
    if (!token || !call) return;
    await postMessage({
      apiBaseUrl: API_BASE_URL,
      token,
      body: {
        callId: call.callId,
        accountId: call.accountId,
        operatorId: OPERATOR_ID,
        body,
      },
    });
  }

  return (
    <main data-ws-ready={wsReady ? 'true' : 'false'}>
      {wsReady && <span data-testid="ws-ready" hidden />}
      <h1>Operator</h1>
      {declineError && <Banner variant="warning" message={declineError} onDismiss={() => setDeclineError(null)} />}
      <ScreenPop
        call={call}
        accepted={accepted}
        paused={paused}
        onAccept={() => setAccepted(true)}
        onDecline={onDecline}
        declinePending={declinePending}
        pciPending={isPciPending}
        onPciToggle={async () => {
          if (!token || !call) return;
          const next = !paused;
          setIsPciPending(true);
          try {
            if (next) {
              await pauseCall({ apiBaseUrl: API_BASE_URL, token, callId: call.callId });
            } else {
              await resumeCall({ apiBaseUrl: API_BASE_URL, token, callId: call.callId });
            }
            setPaused(next);
          } catch (err) {
            console.error('pause/resume failed', err);
            // Don't flip local state — keeps UI consistent with backend.
          } finally {
            setIsPciPending(false);
          }
        }}
        callEnded={callEnded}
        onBannerDismiss={() => { setCall(null); setCallEnded(undefined); }}
      />
      <MessageForm onSubmit={submitMessage} disabled={!accepted || !call} />
    </main>
  );
}
