/**
 * TitlebarChrome — horizontal dock nav + workbench launchers fused into the
 * frameless title bar (replaces left/right vertical icon rails).
 */

import { DockToolbar } from '../dock/DockToolbar.js';
import { WorkbenchPanelsMenu } from '../workbench/WorkbenchPanelsMenu.js';
import { beginNewChatFromDock } from '../dock/dockShared.js';
import { useDockSearchStore } from '../../store/useDockSearchStore.js';
import { useDockSchedulesStore } from '../../store/useDockSchedulesStore.js';
import { useWorkspaceLauncherStore } from '../../store/useWorkspaceLauncherStore.js';
import { useEnabledScheduleCount } from '../../hooks/useEnabledScheduleCount.js';
import { useUiStore } from '../../store/useUiStore.js';
import { useAppViewStore } from '../../store/useAppViewStore.js';
import { TITLEBAR_NAV_ZONE_CLASS, TITLEBAR_WORKBENCH_ZONE_CLASS } from './titlebarShared.js';

export interface TitlebarChromeProps {
  onBackFromSettings: () => void;
}

export function TitlebarDockChrome({ onBackFromSettings }: TitlebarChromeProps) {
  const settingsOpen = useAppViewStore((s) => s.view === 'settings');
  const dockExpanded = useUiStore((s) => s.dockExpanded);
  const toggleDock = useUiStore((s) => s.toggleDock);
  const setDockExpanded = useUiStore((s) => s.setDockExpanded);
  const searchOpen = useDockSearchStore((s) => s.open);
  const schedulesOpen = useDockSchedulesStore((s) => s.open);
  const toggleSearch = useDockSearchStore((s) => s.toggle);
  const toggleSchedules = useDockSchedulesStore((s) => s.toggle);
  const enabledScheduleCount = useEnabledScheduleCount();

  const handleToggleSearch = () => {
    if (settingsOpen) return;
    if (!dockExpanded) setDockExpanded(true);
    const next = !searchOpen;
    if (next) {
      useDockSchedulesStore.getState().setOpen(false);
      useWorkspaceLauncherStore.getState().setOpen(false);
    }
    toggleSearch();
  };

  const handleToggleSchedules = () => {
    if (settingsOpen) return;
    if (!dockExpanded) setDockExpanded(true);
    const next = !schedulesOpen;
    if (next) {
      useDockSearchStore.getState().setOpen(false);
      useWorkspaceLauncherStore.getState().setOpen(false);
    }
    toggleSchedules();
  };

  const handleCollapse = () => {
    if (settingsOpen) return;
    if (dockExpanded) toggleDock();
    else setDockExpanded(true);
  };

  return (
    <div className={TITLEBAR_NAV_ZONE_CLASS}>
      <DockToolbar
        dockExpanded={dockExpanded}
        searchOpen={searchOpen}
        schedulesOpen={schedulesOpen}
        enabledScheduleCount={enabledScheduleCount}
        onNewChat={() => {
          if (settingsOpen) return;
          void beginNewChatFromDock();
        }}
        onToggleSearch={handleToggleSearch}
        onToggleSchedules={handleToggleSchedules}
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

  if (settingsOpen) return null;

  return (
    <div className={TITLEBAR_WORKBENCH_ZONE_CLASS} data-titlebar-workbench-tray>
      <WorkbenchPanelsMenu />
    </div>
  );
}
