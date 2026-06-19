/**
 * Default keyboard binding ids and platform-aware defaults.
 */

export type KeybindingId =
  | 'toggleDock'
  | 'openSearch'
  | 'prevChat'
  | 'nextChat'
  | 'nextWorkspace'
  | 'prevWorkspace'
  | 'newConversation'
  | 'openWorkspace'
  | 'openSettings'
  | 'saveEditor'
  | 'toggleTerminal'
  | 'closeWorkbenchTab'
  | 'cycleWorkbenchTabPrev'
  | 'cycleWorkbenchTabNext'
  | 'reload'
  | 'toggleDevTools'
  | 'timelineFind'
  | 'closeSettings'
  | 'composerQueue'
  | 'composerStop';

export interface KeybindingDefinition {
  id: KeybindingId;
  label: string;
  /** Windows/Linux default (Mod = Ctrl). */
  defaultCombo: string;
  /** macOS default when different. */
  macCombo?: string;
  group: 'Navigation' | 'Workspace' | 'Window' | 'Timeline' | 'Settings' | 'Composer';
}

export const KEYBINDING_DEFINITIONS: readonly KeybindingDefinition[] = [
  { id: 'toggleDock', label: 'Toggle navigation dock', defaultCombo: 'Mod+B', group: 'Navigation' },
  { id: 'openSearch', label: 'Search chats and workspace files', defaultCombo: 'Mod+K', group: 'Navigation' },
  { id: 'prevChat', label: 'Previous chat', defaultCombo: 'Alt+ArrowUp', group: 'Navigation' },
  { id: 'nextChat', label: 'Next chat', defaultCombo: 'Alt+ArrowDown', group: 'Navigation' },
  { id: 'nextWorkspace', label: 'Next workspace', defaultCombo: 'Mod+Tab', group: 'Workspace' },
  { id: 'prevWorkspace', label: 'Previous workspace', defaultCombo: 'Mod+Shift+Tab', group: 'Workspace' },
  { id: 'newConversation', label: 'New conversation', defaultCombo: 'Mod+N', group: 'Workspace' },
  { id: 'openWorkspace', label: 'Open workspace', defaultCombo: 'Mod+O', group: 'Workspace' },
  { id: 'openSettings', label: 'Settings', defaultCombo: 'Mod+,', group: 'Workspace' },
  { id: 'saveEditor', label: 'Save file in editor', defaultCombo: 'Mod+S', group: 'Window' },
  { id: 'toggleTerminal', label: 'Toggle terminal', defaultCombo: 'Mod+`', group: 'Window' },
  { id: 'closeWorkbenchTab', label: 'Close workbench tab', defaultCombo: 'Mod+W', group: 'Window' },
  {
    id: 'cycleWorkbenchTabPrev',
    label: 'Previous workbench tab',
    defaultCombo: 'Mod+Alt+ArrowUp',
    group: 'Window'
  },
  {
    id: 'cycleWorkbenchTabNext',
    label: 'Next workbench tab',
    defaultCombo: 'Mod+Alt+ArrowDown',
    group: 'Window'
  },
  { id: 'reload', label: 'Reload', defaultCombo: 'Mod+R', group: 'Window' },
  { id: 'toggleDevTools', label: 'Toggle DevTools', defaultCombo: 'Mod+Shift+I', group: 'Window' },
  { id: 'timelineFind', label: 'Find in timeline', defaultCombo: 'Mod+F', group: 'Timeline' },
  { id: 'closeSettings', label: 'Close settings', defaultCombo: 'Escape', group: 'Settings' },
  {
    id: 'composerQueue',
    label: 'Queue follow-up (while run active)',
    defaultCombo: 'Mod+Shift+Enter',
    group: 'Composer'
  },
  {
    id: 'composerStop',
    label: 'Stop active run (composer focus)',
    defaultCombo: 'Escape',
    group: 'Composer'
  }
];

export function defaultKeybindingsRecord(isMac: boolean): Record<KeybindingId, string> {
  const out = {} as Record<KeybindingId, string>;
  for (const def of KEYBINDING_DEFINITIONS) {
    out[def.id] = isMac && def.macCombo ? def.macCombo : def.defaultCombo;
  }
  return out;
}

export function parseCombo(combo: string): {
  mod: boolean;
  shift: boolean;
  alt: boolean;
  key: string;
} {
  const parts = combo.split('+').map((p) => p.trim());
  let mod = false;
  let shift = false;
  let alt = false;
  let key = '';
  for (const part of parts) {
    const lower = part.toLowerCase();
    if (lower === 'mod' || lower === 'ctrl' || lower === 'cmd' || lower === 'meta') mod = true;
    else if (lower === 'shift') shift = true;
    else if (lower === 'alt' || lower === 'option') alt = true;
    else key = part;
  }
  return { mod, shift, alt, key: key.toLowerCase() };
}

/** Minimal key surface — accepts DOM and React synthetic keyboard events. */
export type KeyComboEvent = Pick<
  KeyboardEvent,
  'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey' | 'key'
>;

export function eventMatchesCombo(e: KeyComboEvent, combo: string | undefined): boolean {
  if (!combo) return false;
  const { mod, shift, alt, key } = parseCombo(combo);
  const eventMod = e.ctrlKey || e.metaKey;
  if (mod !== eventMod) return false;
  if (shift !== e.shiftKey) return false;
  if (alt !== e.altKey) return false;
  if (key === 'arrowup') return e.key === 'ArrowUp';
  if (key === 'arrowdown') return e.key === 'ArrowDown';
  if (key === 'escape') return e.key === 'Escape';
  if (key === 'tab') return e.key === 'Tab';
  if (key === '`') return e.key === '`';
  if (key === ',') return e.key === ',';
  return e.key.toLowerCase() === key;
}
