/**
 * ComposerDialog — mini FloatingPanel above the composer (§6 smoke).
 *
 * The dialog is anchored above the composer in production via
 * `ComposerDialogAnchor`. These unit tests bypass the anchor and
 * render the dialog directly so we can assert chrome/contract.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRef } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ComposerDialog } from '@renderer/components/ui/ComposerDialog';

afterEach(() => {
  document.body.innerHTML = '';
});

describe('ComposerDialog', () => {
  it('renders title, body, and a close X button', () => {
    render(
      <ComposerDialog open onClose={vi.fn()} title="Approve edit">
        <p>Body content</p>
      </ComposerDialog>
    );
    expect(screen.getByText('Approve edit')).toBeTruthy();
    expect(screen.getByText('Body content')).toBeTruthy();
    expect(screen.getByRole('button', { name: /close/i })).toBeTruthy();
  });

  it('does not render a backdrop element (composer must remain usable)', () => {
    render(
      <ComposerDialog open onClose={vi.fn()} title="Confirm">
        <p>Body</p>
      </ComposerDialog>
    );
    // No bg-black/40 or bg-black/45 backdrop — only the dialog itself.
    const backdrops = document.querySelectorAll('[class*="bg-black/4"]');
    expect(backdrops.length).toBe(0);
  });

  it('Escape calls onClose unless disabled', async () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <ComposerDialog open onClose={onClose} title="Confirm">
        <p>Body</p>
      </ComposerDialog>
    );
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);

    onClose.mockClear();
    rerender(
      <ComposerDialog open onClose={onClose} title="Confirm" disableEscape>
        <p>Body</p>
      </ComposerDialog>
    );
    await userEvent.keyboard('{Escape}');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('Enter clicks the wired primary ref', async () => {
    const primaryRef = createRef<HTMLButtonElement>();
    const onPrimary = vi.fn();
    render(
      <ComposerDialog
        open
        onClose={vi.fn()}
        title="Confirm"
        enterPrimaryRef={primaryRef}
      >
        <button ref={primaryRef} type="button" onClick={onPrimary}>
          Accept
        </button>
      </ComposerDialog>
    );
    // Move focus off the textarea so Enter routes through the dialog
    // container handler (the close button is fine).
    screen.getByRole('button', { name: /close/i }).focus();
    await userEvent.keyboard('{Enter}');
    expect(onPrimary).toHaveBeenCalled();
  });

  it('switches between compact and expanded sizes', () => {
    const { rerender } = render(
      <ComposerDialog open onClose={vi.fn()} title="Diff" size="compact">
        <p>Diff body</p>
      </ComposerDialog>
    );
    let dialog = document.querySelector('.vx-composer-dialog') as HTMLElement;
    expect(dialog.dataset.size).toBe('compact');

    rerender(
      <ComposerDialog open onClose={vi.fn()} title="Diff" size="expanded">
        <p>Diff body</p>
      </ComposerDialog>
    );
    dialog = document.querySelector('.vx-composer-dialog') as HTMLElement;
    expect(dialog.dataset.size).toBe('expanded');
  });

  it('renders an optional badge in the header', () => {
    render(
      <ComposerDialog
        open
        onClose={vi.fn()}
        title="Approve edit"
        badge={<span data-testid="queue-badge">Approval 2 of 5</span>}
      >
        <p>Body</p>
      </ComposerDialog>
    );
    expect(screen.getByTestId('queue-badge').textContent).toContain('Approval 2 of 5');
  });
});
