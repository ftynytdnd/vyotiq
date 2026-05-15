/**
 * View menu — UI toggles plus dev affordances (reload, devtools).
 *
 * The sidebar toggle reads from `useUiStore`, so the visible label flips
 * between "Hide Sidebar" and "Show Sidebar" without the host wiring it.
 */

import { useUiStore } from '../../../../store/useUiStore.js';
import { vyotiq } from '../../../../lib/ipc.js';
import { MenuItem } from '../MenuItem.js';
import { MenuSeparator } from '../MenuSeparator.js';

export function ViewMenu({ onAfterAction }: { onAfterAction: () => void }) {
  const sidebarOpen = useUiStore((s) => s.sidebarOpen);
  const toggleSidebar = useUiStore((s) => s.toggleSidebar);

  return (
    <>
      <MenuItem
        label={sidebarOpen ? 'Hide Sidebar' : 'Show Sidebar'}
        shortcut="Ctrl+B"
        onSelect={toggleSidebar}
        onAfterAction={onAfterAction}
      />
      <MenuSeparator />
      <MenuItem
        label="Reload"
        shortcut="Ctrl+R"
        onSelect={() => void vyotiq.window.reload()}
        onAfterAction={onAfterAction}
      />
      <MenuItem
        label="Toggle DevTools"
        shortcut="Ctrl+Shift+I"
        onSelect={() => void vyotiq.window.toggleDevTools()}
        onAfterAction={onAfterAction}
      />
    </>
  );
}
