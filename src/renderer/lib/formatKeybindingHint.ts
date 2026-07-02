/**
 * Format keybinding combos for muted landing hints.
 */

export function formatKeybindingHint(combo: string, isMac: boolean): string {
  return combo
    .replace(/Mod\+/g, isMac ? '⌘' : 'Ctrl+')
    .replace(/Shift\+/g, isMac ? '⇧' : 'Shift+')
    .replace(/Alt\+/g, isMac ? '⌥' : 'Alt+')
    .replace(/Enter/g, '↵')
    .replace(/Escape/g, 'Esc');
}
