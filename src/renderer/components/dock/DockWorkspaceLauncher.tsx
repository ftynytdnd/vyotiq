/**
 * Dock-anchored workspace launcher flyout (Mod+O).
 */

import { useWorkspaceLauncherStore } from '../../store/useWorkspaceLauncherStore.js';
import { WorkspaceLauncher } from '../workspace/WorkspaceLauncher.js';

export function DockWorkspaceLauncher() {
  const open = useWorkspaceLauncherStore((s) => s.open && s.placement === 'inline');
  const setOpen = useWorkspaceLauncherStore((s) => s.setOpen);

  if (!open) return null;

  return (
    <div
      role="search"
      aria-label="Open workspace"
      className="vx-workspace-launcher-dock flex shrink-0 flex-col gap-0 border-b border-border-subtle/30 px-2 pb-2 pt-1"
    >
      <WorkspaceLauncher active={open} onClose={() => setOpen(false)} />
    </div>
  );
}
