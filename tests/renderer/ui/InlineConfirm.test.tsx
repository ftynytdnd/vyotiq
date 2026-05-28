/**
 * InlineConfirm — row-level destructive confirm contract (§6 smoke).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { InlineConfirm } from '@renderer/components/ui/InlineConfirm';
import { useToastStore } from '@renderer/store/useToastStore';

beforeEach(() => {
  for (const t of useToastStore.getState().toasts) {
    useToastStore.getState().dismiss(t.id);
  }
});

afterEach(() => {
  document.body.innerHTML = '';
  for (const t of useToastStore.getState().toasts) {
    useToastStore.getState().dismiss(t.id);
  }
});

describe('InlineConfirm', () => {
  it('shows the muted context, question, Cancel, and Delete buttons', () => {
    render(
      <InlineConfirm
        context="my-chat"
        question="Remove this chat?"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    expect(screen.getByText('my-chat')).toBeTruthy();
    expect(screen.getByText('Remove this chat?')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeTruthy();
  });

  it('Cancel button fires onCancel; Delete fires onConfirm', async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <InlineConfirm
        question="Remove?"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    );
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('clicking outside the row cancels the confirm', async () => {
    const onCancel = vi.fn();
    render(
      <div>
        <button type="button" data-testid="outside">
          Outside
        </button>
        <InlineConfirm question="Remove?" onConfirm={vi.fn()} onCancel={onCancel} />
      </div>
    );
    // pointerdown is the trigger — userEvent.click dispatches it.
    await userEvent.click(screen.getByTestId('outside'));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('click-away shows a brief toast but Cancel and Escape do not', async () => {
    const onCancel = vi.fn();
    render(
      <div>
        <button type="button" data-testid="outside">
          Outside
        </button>
        <InlineConfirm question="Remove?" onConfirm={vi.fn()} onCancel={onCancel} />
      </div>
    );
    await userEvent.click(screen.getByTestId('outside'));
    expect(useToastStore.getState().toasts.at(-1)?.message).toBe('Delete cancelled');

    for (const t of useToastStore.getState().toasts) {
      useToastStore.getState().dismiss(t.id);
    }
    onCancel.mockClear();

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(useToastStore.getState().toasts).toHaveLength(0);

    await userEvent.keyboard('{Escape}');
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it('Escape cancels the confirm', async () => {
    const onCancel = vi.fn();
    render(<InlineConfirm question="Remove?" onConfirm={vi.fn()} onCancel={onCancel} />);
    await userEvent.keyboard('{Escape}');
    expect(onCancel).toHaveBeenCalled();
  });

  it('clicks inside the confirm do not cancel', async () => {
    const onCancel = vi.fn();
    render(<InlineConfirm question="Remove?" onConfirm={vi.fn()} onCancel={onCancel} />);
    // Click the question text — inside the row.
    await userEvent.click(screen.getByText('Remove?'));
    expect(onCancel).not.toHaveBeenCalled();
  });
});
