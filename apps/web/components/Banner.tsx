'use client';
import { useEffect, useRef, useState } from 'react';

export type BannerVariant = 'info' | 'warning' | 'success';

export interface BannerProps {
  variant: BannerVariant;
  message: string;
  onDismiss?: () => void;
  timeoutMs?: number;
}

export function Banner({ variant, message, onDismiss, timeoutMs = 5000 }: BannerProps) {
  const [visible, setVisible] = useState(true);
  const onDismissRef = useRef(onDismiss);
  useEffect(() => { onDismissRef.current = onDismiss; });
  useEffect(() => {
    const t = setTimeout(() => {
      setVisible(false);
      onDismissRef.current?.();
    }, timeoutMs);
    return () => clearTimeout(t);
  }, [timeoutMs]);
  if (!visible) return null;
  return (
    <div role="status" className={`banner banner--${variant}`}>
      {message}
    </div>
  );
}

export default Banner;
