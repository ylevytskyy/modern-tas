'use client';
import { useState } from 'react';

export interface MessageFormProps {
  onSubmit: (body: string) => Promise<void> | void;
  disabled: boolean;
}

export function MessageForm({ onSubmit, disabled }: MessageFormProps) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed) return;
    setSending(true);
    try {
      await onSubmit(trimmed);
      setText('');
    } finally {
      setSending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} aria-label="message-form">
      <label>
        Message
        <textarea value={text} onChange={(e) => setText(e.target.value)} />
      </label>
      <button type="submit" disabled={disabled || sending}>Send</button>
    </form>
  );
}
