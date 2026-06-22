/**
 * Settings → Shortcuts reference + customizable bindings.
 */

import { useMemo, useState } from 'react';
import {
  KEYBINDING_DEFINITIONS,
  type KeybindingId
} from '@shared/keybindings/defaultKeybindings.js';
import { cn } from '../../lib/cn.js';
import { persistSettingsPatch } from '../../lib/persistSettingsPatch.js';
import { isMacPlatform, resolveKeybindings } from '../../lib/resolveKeybindings.js';
import { useSettingsStore } from '../../store/useSettingsStore.js';
import { TextField } from '../ui/TextField.js';
import { Button } from '../ui/Button.js';
import { ShellCaption } from '../ui/ShellSection.js';

export function formatPlatformShortcut(shortcut: string): string {
  const mod = isMacPlatform() ? '\u2318' : 'Ctrl';
  return shortcut
    .replace(/^Mod\+Shift\+/i, `${mod}+Shift+`)
    .replace(/^Mod\+/i, `${mod}+`);
}

interface ShortcutsPanelProps {
  presentation?: 'dialog' | 'region';
}

export function ShortcutsPanel({ presentation = 'region' }: ShortcutsPanelProps) {
  const settings = useSettingsStore((s) => s.settings);
  const isMac = isMacPlatform();
  const resolved = useMemo(
    () => resolveKeybindings(settings.ui?.keybindings, isMac),
    [settings.ui?.keybindings, isMac]
  );
  const [draft, setDraft] = useState<Partial<Record<KeybindingId, string>>>({});

  const role = presentation === 'dialog' ? 'dialog' : 'region';
  const groups = ['Navigation', 'Workspace', 'Window', 'Timeline', 'Settings'] as const;

  const saveBinding = (id: KeybindingId) => {
    const value = draft[id]?.trim();
    const next = { ...(settings.ui?.keybindings ?? {}) };
    if (!value) delete next[id];
    else next[id] = value;
    void persistSettingsPatch({ ui: { keybindings: next } });
    setDraft((d) => {
      const copy = { ...d };
      delete copy[id];
      return copy;
    });
  };

  const resetAll = () => {
    void persistSettingsPatch({ ui: { keybindings: {} } });
    setDraft({});
  };

  return (
    <div role={role} aria-label="Keyboard shortcuts" className="vx-stack gap-4">
      <ShellCaption>
        Timeline navigation: <kbd className="font-mono">g j</kbd> / <kbd className="font-mono">g k</kbd>{' '}
        for prev/next user prompt; <kbd className="font-mono">Esc</kbd> drops sticky scroll.
      </ShellCaption>
      {groups.map((group) => (
        <section key={group} className="vx-section">
          <h3 className="vx-section-head mb-1">{group}</h3>
          <div className="flex flex-col">
            {KEYBINDING_DEFINITIONS.filter((d) => d.group === group).map((def) => {
              const active = draft[def.id] ?? resolved[def.id];
              return (
                <div
                  key={def.id}
                  className="vx-row flex flex-wrap items-center justify-between gap-3 py-1.5 first:pt-0 last:pb-0"
                >
                  <span className="min-w-0 truncate text-row text-text-muted">{def.label}</span>
                  <div className="flex shrink-0 items-center gap-2">
                    <TextField
                      value={active}
                      onChange={(e) => setDraft((d) => ({ ...d, [def.id]: e.target.value }))}
                      onBlur={() => {
                        if (draft[def.id] !== undefined) saveBinding(def.id);
                      }}
                      className="w-36 font-mono text-meta"
                      aria-label={`Shortcut for ${def.label}`}
                    />
                    <kbd
                      className={cn(
                        'hidden rounded-inner border border-border-subtle/25 bg-surface-overlay/40',
                        'px-1.5 py-0.5 font-mono text-meta tracking-tight text-text-secondary sm:inline'
                      )}
                    >
                      {formatPlatformShortcut(active)}
                    </kbd>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ))}
      <Button variant="secondary" size="sm" onClick={resetAll}>
        Reset to defaults
      </Button>
    </div>
  );
}
