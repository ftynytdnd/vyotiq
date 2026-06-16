/**
 * Right workbench rail — fills the reserved main `paddingRight` strip with
 * always-visible vertical launcher icons (symmetric to the left dock).
 */

import { useEditorStore } from '../../store/useEditorStore.js';
import { useTerminalStore } from '../../store/useTerminalStore.js';
import { useBrowserStore } from '../../store/useBrowserStore.js';
import { WORKBENCH_EDGE_STRIP_CLASS } from './workbenchChrome.js';
import { WorkbenchLaunchers } from './WorkbenchLaunchers.js';

export function RightWorkbenchRail() {
  const terminalOpen = useTerminalStore((s) => s.open);
  const browserOpen = useBrowserStore((s) => s.open);
  const editorOpen = useEditorStore((s) => s.open);

  return (
    <nav
      className={WORKBENCH_EDGE_STRIP_CLASS}
      data-workbench-right-rail
      aria-label="Workbench panels"
    >
      <WorkbenchLaunchers
        terminalOpen={terminalOpen}
        browserOpen={browserOpen}
        editorOpen={editorOpen}
      />
    </nav>
  );
}
