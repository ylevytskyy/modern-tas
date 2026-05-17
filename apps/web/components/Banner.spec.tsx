import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { Banner } from './Banner';

describe('Banner', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('renders the message with role=status for a11y', () => {
    render(<Banner variant="warning" message="Caller hung up" />);
    const node = screen.getByRole('status');
    expect(node).toHaveTextContent('Caller hung up');
  });

  it('applies a variant-specific class', () => {
    render(<Banner variant="warning" message="x" />);
    expect(screen.getByRole('status').className).toContain('banner--warning');
  });

  it('auto-dismisses after 5s and calls onDismiss', () => {
    const onDismiss = vi.fn();
    render(<Banner variant="info" message="x" onDismiss={onDismiss} />);
    expect(screen.queryByRole('status')).not.toBeNull();
    act(() => { vi.advanceTimersByTime(5000); });
    expect(screen.queryByRole('status')).toBeNull();
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('does not call onDismiss if unmounted before timeout', () => {
    const onDismiss = vi.fn();
    const { unmount } = render(<Banner variant="info" message="x" onDismiss={onDismiss} />);
    unmount();
    act(() => { vi.advanceTimersByTime(5000); });
    expect(onDismiss).not.toHaveBeenCalled();
  });
});
