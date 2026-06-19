import { describe, expect, it } from 'vitest';
import { eventMatchesCombo } from '@shared/keybindings/defaultKeybindings.js';

describe('eventMatchesCombo', () => {
  it('matches Mod+Shift+Enter for queue shortcut', () => {
    const match = eventMatchesCombo(
      {
        ctrlKey: true,
        metaKey: false,
        shiftKey: true,
        altKey: false,
        key: 'Enter'
      },
      'Mod+Shift+Enter'
    );
    expect(match).toBe(true);
  });

  it('does not treat plain Enter as Mod+Shift+Enter', () => {
    const match = eventMatchesCombo(
      {
        ctrlKey: false,
        metaKey: false,
        shiftKey: false,
        altKey: false,
        key: 'Enter'
      },
      'Mod+Shift+Enter'
    );
    expect(match).toBe(false);
  });
});
