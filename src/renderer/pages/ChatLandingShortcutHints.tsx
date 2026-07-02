/**
 * Muted keyboard shortcut hints below the empty-chat landing composer.
 */

import { useMemo } from 'react';
import { useSettingsStore } from '../store/useSettingsStore.js';
import { formatKeybindingHint } from '../lib/formatKeybindingHint.js';
import { isMacPlatform, resolveKeybindings } from '../lib/resolveKeybindings.js';

export function ChatLandingShortcutHints() {
  const keybindingOverrides = useSettingsStore((s) => s.settings.ui?.keybindings);
  const isMac = isMacPlatform();

  const line = useMemo(() => {
    const bindings = resolveKeybindings(keybindingOverrides, isMac);
    const search = formatKeybindingHint(bindings.openSearch, isMac);
    const focus = formatKeybindingHint(bindings.focusComposer, isMac);
    const open = formatKeybindingHint(bindings.openWorkspace, isMac);
    return `${search} search · ${focus} focus · ${open} open workspace · click context above to browse`;
  }, [keybindingOverrides, isMac]);

  return (
    <p className="mt-3 text-center font-mono text-meta text-text-faint" aria-label="Keyboard shortcuts">
      {line}
    </p>
  );
}
