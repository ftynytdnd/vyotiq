/**
 * `AttachmentButton` count badge — gives the user a persistent
 * attachment-count signal next to the `+` icon even when the chip
 * strip wraps off-screen. The trigger keeps its single-width footprint
 * when nothing is selected so the toolbar layout doesn't shift on
 * the idle case.
 */

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AttachmentButton } from '@renderer/components/composer/AttachmentButton';

describe('AttachmentButton count badge', () => {
  it('renders no badge when nothing is selected', () => {
    const { container } = render(
      <AttachmentButton
        open={false}
        onOpen={() => {}}
        onClose={() => {}}
        selected={[]}
        onPick={() => {}}
        onPickFromComputer={() => {}}
      />
    );
    const btn = container.querySelector('button')!;
    // No numeric count text inside the button — only the `+` icon.
    expect(btn.textContent ?? '').toBe('');
    expect(btn.getAttribute('aria-label')).toBe('Attach files');
    expect(btn.getAttribute('title')).toBe('Attach files');
  });

  it('renders the count when one or more attachments are selected', () => {
    const { container } = render(
      <AttachmentButton
        open={false}
        onOpen={() => {}}
        onClose={() => {}}
        selected={['src/a.ts', 'src/b.ts', 'README.md']}
        onPick={() => {}}
        onPickFromComputer={() => {}}
      />
    );
    const btn = container.querySelector('button')!;
    expect(btn.textContent).toContain('3');
    expect(btn.getAttribute('aria-label')).toBe('Attach files, 3 selected');
    expect(btn.getAttribute('title')).toContain('3 selected');
  });

  it('shows unified attach sources before opening the workspace picker', async () => {
    const onPickFromComputer = vi.fn();
    render(
      <AttachmentButton
        open
        onOpen={() => {}}
        onClose={() => {}}
        selected={[]}
        onPick={() => {}}
        onPickFromComputer={onPickFromComputer}
      />
    );
    expect(screen.getByRole('button', { name: 'From workspace' })).toBeInTheDocument();
    const computerBtn = screen.getByRole('button', { name: 'From computer' });
    expect(computerBtn).toBeInTheDocument();
    await userEvent.click(computerBtn);
    expect(onPickFromComputer).toHaveBeenCalledOnce();
  });
});
