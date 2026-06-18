/**
 * TitlebarChrome — horizontal dock nav + workbench launchers fused into the
 * frameless title bar (replaces left/right vertical icon rails).
 */

import { DockToolbar } from '../dock/DockToolbar.js';
import { WorkbenchLaunchers } from '../workbench/WorkbenchLaunchers.js';
import { beginNewChatFromDock } from '../dock/dockShared.js';
import { useDockSearchStore } from '../../store/useDockSearchStore.js';
import { useUiStore } from '../../store/useUiStore.js';
import { useTerminalStore } from '../../store/useTerminalStore.js';
import { useBrowserStore } from '../../store/useBrowserStore.js';
import { useEditorStore } from '../../store/useEditorStore.js';
import { useAppViewStore } from '../../store/useAppViewStore.js';
import { TITLEBAR_NAV_ZONE_CLASS, TITLEBAR_WORKBENCH_ZONE_CLASS } from './titlebarShared.js';

export interface TitlebarChromeProps {
  onOpenSettings: () => void;
  onBackFromSettings: () => void;
}

export function TitlebarDockChrome({ onOpenSettings, onBackFromSettings }: TitlebarChromeProps) {
  const settingsOpen = useAppViewStore((s) => s.view === 'settings');
  const dockExpanded = useUiStore((s) => s.dockExpanded);
  const toggleDock = useUiStore((s) => s.toggleDock);
  const setDockExpanded = useUiStore((s) => s.setDockExpanded);
  const searchOpen = useDockSearchStore((s) => s.open);
  const toggleSearch = useDockSearchStore((s) => s.toggle);

  const handleToggleSearch = () => {
    if (settingsOpen) return;
    if (!dockExpanded) setDockExpanded(true);
    toggleSearch();
  };

  const handleCollapse = () => {
    if (settingsOpen) return;
    if (dockExpanded) toggleDock();
    else setDockExpanded(true);
  };

  return (
    <div className={TITLEBAR_NAV_ZONE_CLASS}>
      <DockToolbar
        layout="horizontal"
        titlebarMode
        dockExpanded={dockExpanded}
        searchOpen={searchOpen}
        onNewChat={() => {
          if (settingsOpen) return;
          void beginNewChatFromDock();
        }}
        onToggleSearch={handleToggleSearch}
        onOpenSettings={onOpenSettings}
        onCollapse={handleCollapse}
        collapseIcon={dockExpanded ? 'left' : 'right'}
        settingsMode={settingsOpen}
        onBackFromSettings={onBackFromSettings}
        className="min-w-0"
      />
    </div>
  );
}

export function TitlebarWorkbenchChrome() {
  const settingsOpen = useAppViewStore((s) => s.view === 'settings');
  const terminalOpen = useTerminalStore((s) => s.open);
  const browserOpen = useBrowserStore((s) => s.open);
  const editorOpen = useEditorStore((s) => s.open);

  if (settingsOpen) return null;

  return (
    <div className={TITLEBAR_WORKBENCH_ZONE_CLASS} data-titlebar-workbench-tray>
      <WorkbenchLaunchers
        layout="horizontal"
        titlebarMode
        terminalOpen={terminalOpen}
        browserOpen={browserOpen}
        editorOpen={editorOpen}
      />
    </div>
  );
}
