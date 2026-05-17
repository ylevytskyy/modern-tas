import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MessageForm } from './MessageForm';

describe('MessageForm', () => {
  it('calls onSubmit with the trimmed body text when submitted', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<MessageForm onSubmit={onSubmit} disabled={false} />);
    await userEvent.type(screen.getByRole('textbox', { name: /message/i }), '  hello there  ');
    await userEvent.click(screen.getByRole('button', { name: /send/i }));
    expect(onSubmit).toHaveBeenCalledWith('hello there');
  });

  it('disables the submit button when disabled=true', () => {
    render(<MessageForm onSubmit={vi.fn()} disabled={true} />);
    expect(screen.getByRole('button', { name: /send/i })).toBeDisabled();
  });

  it('does not call onSubmit when the textarea is empty', async () => {
    const onSubmit = vi.fn();
    render(<MessageForm onSubmit={onSubmit} disabled={false} />);
    await userEvent.click(screen.getByRole('button', { name: /send/i }));
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
