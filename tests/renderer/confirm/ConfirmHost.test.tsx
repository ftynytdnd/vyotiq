/**
 * `ConfirmHost` tests.
 *   - Subscribes to `tools.onConfirmRequest` on mount.
 *   - Shows queue depth in the dialog title (Phase-2 indicator).
 *   - Calls `respondConfirm` with the head id when buttons fire.
 */

import { StrictMode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfirmHost } from '@renderer/components/confirm/ConfirmHost';

type ConfirmCb = (req: { id: string; message: string }) => void;

function rigOnConfirmRequest(): {
  emit: ConfirmCb;
  onConfirmRequestSpy: ReturnType<typeof vi.fn>;
} {
  let emit: ConfirmCb = () => { };
  const onConfirmRequestSpy = vi.fn((cb: ConfirmCb) => {
    emit = cb;
    return () => { };
  });
  window.vyotiq.tools.onConfirmRequest = onConfirmRequestSpy as unknown as typeof window.vyotiq.tools.onConfirmRequest;
  return {
    emit: ((req) => emit(req)) as ConfirmCb,
    onConfirmRequestSpy
  };
}

describe('ConfirmHost', () => {
  it('subscribes on mount', () => {
    const { onConfirmRequestSpy } = rigOnConfirmRequest();
    render(<ConfirmHost />);
    expect(onConfirmRequestSpy).toHaveBeenCalledOnce();
  });

  it('renders the head request message', () => {
    const { emit } = rigOnConfirmRequest();
    render(<ConfirmHost />);
    act(() => emit({ id: '1', message: 'Run rm -rf node_modules?' }));
    expect(screen.getByText(/rm -rf node_modules/)).toBeInTheDocument();
  });

  it('shows queue depth in the title when more than one is pending', () => {
    const { emit } = rigOnConfirmRequest();
    render(<ConfirmHost />);
    act(() => {
      emit({ id: '1', message: 'a' });
      emit({ id: '2', message: 'b' });
      emit({ id: '3', message: 'c' });
    });
    expect(screen.getByText(/Confirmation required \(\+2 queued\)/)).toBeInTheDocument();
  });

  it('does NOT add a queue suffix for a single confirm', () => {
    const { emit } = rigOnConfirmRequest();
    render(<ConfirmHost />);
    act(() => emit({ id: '1', message: 'a' }));
    expect(screen.getByText(/^Confirmation required$/)).toBeInTheDocument();
  });

  it('calls respondConfirm(id, true) on Approve and advances the queue', async () => {
    const { emit } = rigOnConfirmRequest();
    const respond = vi.fn();
    window.vyotiq.tools.respondConfirm = respond as unknown as typeof window.vyotiq.tools.respondConfirm;
    render(<ConfirmHost />);
    act(() => {
      emit({ id: 'first', message: 'Pick A' });
      emit({ id: 'second', message: 'Pick B' });
    });
    expect(screen.getByText('Pick A')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(respond).toHaveBeenCalledWith('first', true);
    // The next confirm should now be visible.
    expect(screen.getByText('Pick B')).toBeInTheDocument();
  });

  it('calls respondConfirm(id, false) on Deny', async () => {
    const { emit } = rigOnConfirmRequest();
    const respond = vi.fn();
    window.vyotiq.tools.respondConfirm = respond as unknown as typeof window.vyotiq.tools.respondConfirm;
    render(<ConfirmHost />);
    act(() => emit({ id: 'only', message: 'Erase disk?' }));
    await userEvent.click(screen.getByRole('button', { name: 'Deny' }));
    expect(respond).toHaveBeenCalledWith('only', false);
  });

  it('dispatches respondConfirm exactly once under React StrictMode (H7 regression)', async () => {
    // Regression: the `respond` handler dispatches the
    // `vyotiq.tools.respondConfirm` IPC inside a `setState` updater
    // so the pop-and-answer stays atomic against rapid double-clicks.
    // React StrictMode invokes every state updater TWICE in
    // development to flush out impure writes — the prior code fired
    // the IPC twice as a result. The H7 fix layers a render-stable
    // `respondedIdsRef` over the updater so the second invocation
    // recognises the id has already been answered and short-circuits
    // the dispatch.
    const { emit } = rigOnConfirmRequest();
    const respond = vi.fn();
    window.vyotiq.tools.respondConfirm =
      respond as unknown as typeof window.vyotiq.tools.respondConfirm;
    render(
      <StrictMode>
        <ConfirmHost />
      </StrictMode>
    );
    act(() => emit({ id: 'strict-id', message: 'StrictMode test' }));

    await userEvent.click(screen.getByRole('button', { name: 'Approve' }));

    // Exactly one IPC dispatch for this id, even though StrictMode
    // ran the setState updater twice.
    expect(respond).toHaveBeenCalledTimes(1);
    expect(respond).toHaveBeenCalledWith('strict-id', true);
  });

  it('does not resolve twice when the Approve button is clicked rapidly', async () => {
    // Regression: an older implementation read `pending[0]` from the
    // outer closure, so a double-click captured the SAME head id twice
    // before React re-rendered — both clicks sent `respondConfirm(A,…)`
    // AND both popped an entry, leaving B un-answered while the main-
    // side promise waited for its 5-minute timeout. The fix reads the
    // head inside the functional updater so each pop is atomic.
    const { emit } = rigOnConfirmRequest();
    const respond = vi.fn();
    window.vyotiq.tools.respondConfirm =
      respond as unknown as typeof window.vyotiq.tools.respondConfirm;
    render(<ConfirmHost />);
    act(() => {
      emit({ id: 'A', message: 'first' });
      emit({ id: 'B', message: 'second' });
    });

    // Fire both clicks synchronously in the same React batch so the
    // second click still sees `pending = [A, B]` in its outer closure.
    // Without the fix, both clicks would invoke `respondConfirm('A', …)`.
    const approve = screen.getByRole('button', { name: 'Approve' });
    act(() => {
      approve.dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true })
      );
      approve.dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true })
      );
    });

    // Each id must be answered exactly once. `respond` was called twice
    // in total, once per queued confirmation.
    expect(respond).toHaveBeenCalledTimes(2);
    expect(respond.mock.calls[0]).toEqual(['A', true]);
    expect(respond.mock.calls[1]).toEqual(['B', true]);
  });
});
