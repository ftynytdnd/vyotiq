/**
 * View menu — UI toggles plus dev affordances (reload, devtools).
 *
 * The dock toggle reads from `useUiStore`, so the visible label flips
 * between "Collapse Dock" and "Expand Dock" without the host wiring it.
 */

import { useUiStore } from '../../../../store/useUiStore.js';
import { vyotiq } from '../../../../lib/ipc.js';
import { MenuItem } from '../MenuItem.js';
import { MenuSeparator } from '../MenuSeparator.js';
import { formatPlatformShortcut } from '../../../shortcuts/ShortcutsPanel.js';

export interface ViewMenuActions {
  openContextInspector: () => void;
}

export function ViewMenu({
  actions,
  onAfterAction
}: {
  actions: ViewMenuActions;
  onAfterAction: () => void;
}) {
  const dockExpanded = useUiStore((s) => s.dockExpanded);
  const toggleDock = useUiStore((s) => s.toggleDock);

  return (
    <>
      <MenuItem
        label={dockExpanded ? 'Collapse Dock' : 'Expand Dock'}
        shortcut={formatPlatformShortcut('Ctrl+B')}
        onSelect={toggleDock}
        onAfterAction={onAfterAction}
      />
      <MenuSeparator />
      <MenuItem
        label="Context Inspector"
        shortcut={formatPlatformShortcut('Ctrl+Shift+C')}
        onSelect={actions.openContextInspector}
        onAfterAction={onAfterAction}
      />
      <MenuSeparator />
      <MenuItem
        label="Reload"
        shortcut={formatPlatformShortcut('Ctrl+R')}
        onSelect={() => void vyotiq.window.reload()}
        onAfterAction={onAfterAction}
      />
      <MenuItem
        label="Toggle DevTools"
        shortcut={formatPlatformShortcut('Ctrl+Shift+I')}
        onSelect={() => void vyotiq.window.toggleDevTools()}
        onAfterAction={onAfterAction}
      />
    </>
  );
}
