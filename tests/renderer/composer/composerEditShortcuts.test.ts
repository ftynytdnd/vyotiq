import { describe, expect, it, vi } from 'vitest';
import { defaultKeybindingsRecord } from '@shared/keybindings/defaultKeybindings.js';
import { handleComposerEditKeyDown } from '@renderer/components/composer/mention/composerEditShortcuts.js';
import { emptyMentionDocument } from '@renderer/components/composer/mention/mentionDocument.js';

describe('handleComposerEditKeyDown', () => {
  it('defers default Mod+V to the native paste event', () => {
    const root = document.createElement('div');
    root.setAttribute('contenteditable', 'true');
    document.body.appendChild(root);
    root.focus();

    const preventDefault = vi.fn();
    const onPasteFallback = vi.fn();
    const bindings = defaultKeybindingsRecord(false);

    const handled = handleComposerEditKeyDown({
      e: {
        ctrlKey: true,
        metaKey: false,
        shiftKey: false,
        altKey: false,
        key: 'v',
        preventDefault
      },
      root,
      doc: emptyMentionDocument(),
      bindings,
      isMac: false,
      onPasteFallback
    });

    expect(handled).toBe(false);
    expect(preventDefault).not.toHaveBeenCalled();
    expect(onPasteFallback).not.toHaveBeenCalled();
  });

  it('handles remapped paste on keydown', () => {
    const root = document.createElement('div');
    const preventDefault = vi.fn();
    const onPasteFallback = vi.fn();
    const bindings = {
      ...defaultKeybindingsRecord(false),
      composerPaste: 'Mod+Shift+V'
    };

    const handled = handleComposerEditKeyDown({
      e: {
        ctrlKey: true,
        metaKey: false,
        shiftKey: true,
        altKey: false,
        key: 'v',
        preventDefault
      },
      root,
      doc: emptyMentionDocument(),
      bindings,
      isMac: false,
      onPasteFallback
    });

    expect(handled).toBe(true);
    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(onPasteFallback).toHaveBeenCalledTimes(1);
  });

  it('defers default Mod+Z to native undo', () => {
    const root = document.createElement('div');
    const preventDefault = vi.fn();
    const bindings = defaultKeybindingsRecord(false);

    const handled = handleComposerEditKeyDown({
      e: {
        ctrlKey: true,
        metaKey: false,
        shiftKey: false,
        altKey: false,
        key: 'z',
        preventDefault
      },
      root,
      doc: emptyMentionDocument(),
      bindings,
      isMac: false
    });

    expect(handled).toBe(false);
    expect(preventDefault).not.toHaveBeenCalled();
  });
});
