'use client';
import { useEffect, useState } from 'react';
import type { WsIncomingCallPayload, WsCallEndedPayload } from '@tas/shared-types';
import { ScreenPop } from '@/components/ScreenPop';
import { MessageForm } from '@/components/MessageForm';
import { createWsClient } from '@/lib/ws';
import { fetchOperatorToken } from '@/lib/token';
import { postMessage } from '@/lib/api';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3000';
const WS_URL       = process.env.NEXT_PUBLIC_WS_URL ?? 'ws://localhost:3000/ws';
const OPERATOR_ID  = process.env.NEXT_PUBLIC_OPERATOR_ID ?? '66666666-6666-6666-6666-666666666666';

export default function OperatorPage() {
  const [token, setToken] = useState<string | null>(null);
  const [call, setCall] = useState<WsIncomingCallPayload | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [paused, setPaused] = useState(false);
  const [wsReady, setWsReady] = useState(false);
  const [callEnded, setCallEnded] = useState<WsCallEndedPayload | undefined>(undefined);

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
    let clearTimer: ReturnType<typeof setTimeout> | undefined;

    client.onOpen(() => setWsReady(true));
    client.onScreenPop((payload) => {
      clearTimeout(clearTimer);  // cancel any pending call.ended auto-clear
      setCall(payload);
      setAccepted(false);
      setPaused(false);
      setCallEnded(undefined);
    });
    client.onCallEnded((payload) => {
      setCallEnded(payload);
      clearTimer = setTimeout(() => { setCall(null); setCallEnded(undefined); }, 5000);
    });
    return () => {
      clearTimeout(clearTimer);
      client.close();
    };
  }, [token]);

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
      <ScreenPop
        call={call}
        accepted={accepted}
        paused={paused}
        onAccept={() => setAccepted(true)}
        onPciToggle={() => setPaused((p) => !p)}
        callEnded={callEnded}
      />
      <MessageForm onSubmit={submitMessage} disabled={!accepted || !call} />
    </main>
  );
}
