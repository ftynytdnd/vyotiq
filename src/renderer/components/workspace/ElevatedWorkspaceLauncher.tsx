/**
 * Elevated workspace launcher when Settings hides the dock flyout.
 */

import { ComposerDialogPortal } from '../ui/ComposerDialogAnchor.js';
import { useWorkspaceLauncherStore } from '../../store/useWorkspaceLauncherStore.js';
import { WorkspaceLauncher } from './WorkspaceLauncher.js';

export function ElevatedWorkspaceLauncher() {
  const open = useWorkspaceLauncherStore((s) => s.open && s.placement === 'elevated');
  const setOpen = useWorkspaceLauncherStore((s) => s.setOpen);

  if (!open) return null;

  return (
    <ComposerDialogPortal elevated>
      <WorkspaceLauncher active={open} elevated onClose={() => setOpen(false)} />
    </ComposerDialogPortal>
  );
}
