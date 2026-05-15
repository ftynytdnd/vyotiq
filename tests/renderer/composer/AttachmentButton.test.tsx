/**
 * `AttachmentButton` count badge — gives the user a persistent
 * attachment-count signal next to the `+` icon even when the chip
 * strip wraps off-screen. The trigger keeps its single-width footprint
 * when nothing is selected so the toolbar layout doesn't shift on
 * the idle case.
 */

import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
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
      />
    );
    const btn = container.querySelector('button')!;
    // No numeric count text inside the button — only the `+` icon.
    expect(btn.textContent ?? '').toBe('');
    expect(btn.getAttribute('aria-label')).toBe('Attach files from workspace');
    expect(btn.getAttribute('title')).toBe('Attach files from workspace');
  });

  it('renders the count when one or more attachments are selected', () => {
    const { container } = render(
      <AttachmentButton
        open={false}
        onOpen={() => {}}
        onClose={() => {}}
        selected={['src/a.ts', 'src/b.ts', 'README.md']}
        onPick={() => {}}
      />
    );
    const btn = container.querySelector('button')!;
    expect(btn.textContent).toContain('3');
    expect(btn.getAttribute('aria-label')).toBe('Attach files from workspace, 3 selected');
    expect(btn.getAttribute('title')).toContain('3 selected');
  });
});
