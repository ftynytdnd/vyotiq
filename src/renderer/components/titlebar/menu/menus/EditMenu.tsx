/**
 * Edit menu — clipboard actions. Uses `document.execCommand` because it is
 * the only API that actually fires on the focused contenteditable/input
 * element across Electron versions; modern `navigator.clipboard` requires
 * the menu to capture the active selection synchronously which it cannot
 * do once the menu took focus.
 *
 * If the focused element does not support a given action, the browser
 * silently no-ops — that's the desired behavior (UX matches a native menu
 * with greyed-out items).
 */

import { MenuItem } from '../MenuItem.js';
import { MenuSeparator } from '../MenuSeparator.js';

function exec(cmd: 'cut' | 'copy' | 'paste' | 'selectAll' | 'undo' | 'redo'): void {
  try {
    document.execCommand(cmd);
  } catch {
    // execCommand can throw in restrictive contexts; treat as no-op.
  }
}

export function EditMenu({ onAfterAction }: { onAfterAction: () => void }) {
  return (
    <>
      <MenuItem label="Undo" shortcut="Ctrl+Z" onSelect={() => exec('undo')} onAfterAction={onAfterAction} />
      <MenuItem label="Redo" shortcut="Ctrl+Y" onSelect={() => exec('redo')} onAfterAction={onAfterAction} />
      <MenuSeparator />
      <MenuItem label="Cut" shortcut="Ctrl+X" onSelect={() => exec('cut')} onAfterAction={onAfterAction} />
      <MenuItem label="Copy" shortcut="Ctrl+C" onSelect={() => exec('copy')} onAfterAction={onAfterAction} />
      <MenuItem label="Paste" shortcut="Ctrl+V" onSelect={() => exec('paste')} onAfterAction={onAfterAction} />
      <MenuSeparator />
      <MenuItem
        label="Select All"
        shortcut="Ctrl+A"
        onSelect={() => exec('selectAll')}
        onAfterAction={onAfterAction}
      />
    </>
  );
}
