/**
 * ShortcutsPanel documents the shortcuts the app actually binds. This
 * guards the "Find in timeline" (Cmd/Ctrl+F) row specifically — it is a
 * real window-level accelerator wired in `Timeline.tsx` but was missing
 * from the reference card, so the panel under-documented the app.
 */

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ShortcutsPanel } from '@renderer/components/shortcuts/ShortcutsPanel.js';

describe('ShortcutsPanel', () => {
  it('documents the timeline find shortcut', () => {
    render(<ShortcutsPanel />);
    const row = screen.getByText('Find in timeline').closest('.vx-row');
    expect(row).not.toBeNull();
    // Modifier symbol differs per platform (⌘ vs Ctrl); the key is constant.
    expect(row?.textContent).toMatch(/\+F$/);
  });

  it('exposes a keyboard-shortcuts region for assistive tech', () => {
    render(<ShortcutsPanel />);
    expect(screen.getByRole('region', { name: 'Keyboard shortcuts' })).toBeTruthy();
  });
});
