/**
 * ChatLandingShortcutHints — muted keybinding line on ready landing.
 */

import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { ChatLandingShortcutHints } from '@renderer/pages/ChatLandingShortcutHints';
import { useSettingsStore } from '@renderer/store/useSettingsStore';

beforeEach(() => {
  useSettingsStore.setState({
    loading: false,
    initialLoadDone: true,
    settings: { ui: { keybindings: {} } }
  } as never);
});

describe('ChatLandingShortcutHints', () => {
  it('renders search, focus, and open workspace hints', () => {
    render(<ChatLandingShortcutHints />);
    const hint = screen.getByLabelText('Keyboard shortcuts');
    expect(hint.textContent).toMatch(/search/);
    expect(hint.textContent).toMatch(/focus/);
    expect(hint.textContent).toMatch(/open workspace/);
    expect(hint.textContent).toMatch(/click context above to browse/);
  });
});
