/**
 * Workbench launchers — vertical activity icons in the right edge strip.
 */

import { useCallback } from 'react';
import { FileCode2, Globe, TerminalSquare } from 'lucide-react';
import { useTerminalStore } from '../../store/useTerminalStore.js';
import { useBrowserStore } from '../../store/useBrowserStore.js';
import { useEditorStore } from '../../store/useEditorStore.js';
import { useWorkspaceStore } from '../../store/useWorkspaceStore.js';
import { useUiStore } from '../../store/useUiStore.js';
import { focusWorkbenchTab, resolveCompanionTab } from './workbenchShared.js';
import { WORKBENCH_RAIL_BTN_CLASS } from './workbenchChrome.js';
import { DOCK_TAB_ICON_CLASS, DOCK_TAB_ICON_STROKE } from '../dock/dockShared.js';
import { cn } from '../../lib/cn.js';

export interface WorkbenchLaunchersProps {
  terminalOpen: boolean;
  browserOpen: boolean;
  editorOpen: boolean;
}

type LauncherId = 'terminal' | 'browser' | 'editor';

export function WorkbenchLaunchers({
  terminalOpen,
  browserOpen,
  editorOpen
}: WorkbenchLaunchersProps) {
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeId);
  const workspacePath = useWorkspaceStore((s) => s.info.path);
  const workbenchTab = useUiStore((s) => s.workbenchTab);
  const activeCompanion = resolveCompanionTab(workbenchTab);

  const openTerminal = useTerminalStore((s) => s.openPanel);
  const openBrowser = useBrowserStore((s) => s.openPanel);
  const openEditor = useEditorStore((s) => s.openPanel);

  const onLauncher = useCallback(
    (id: LauncherId) => {
      if (id === 'terminal') {
        if (terminalOpen) {
          focusWorkbenchTab('terminal');
          return;
        }
        if (activeWorkspaceId) void openTerminal(activeWorkspaceId);
        return;
      }
      if (id === 'browser') {
        if (browserOpen) {
          focusWorkbenchTab('browser');
          return;
        }
        void openBrowser();
        return;
      }
      if (editorOpen) {
        focusWorkbenchTab('editor');
        return;
      }
      openEditor();
    },
    [
      activeWorkspaceId,
      browserOpen,
      editorOpen,
      openBrowser,
      openEditor,
      openTerminal,
      terminalOpen
    ]
  );

  const items: {
    id: LauncherId;
    label: string;
    title: string;
    open: boolean;
    disabled?: boolean;
    icon: typeof TerminalSquare;
  }[] = [
    {
      id: 'terminal',
      label: 'Terminal',
      title: activeWorkspaceId
        ? terminalOpen
          ? 'Focus terminal'
          : 'Open terminal (Ctrl+`)'
        : 'Choose a workspace to open a terminal',
      open: terminalOpen,
      disabled: !activeWorkspaceId && !terminalOpen,
      icon: TerminalSquare
    },
    {
      id: 'browser',
      label: 'Browser',
      title: browserOpen ? 'Focus browser' : 'Open browser',
      open: browserOpen,
      icon: Globe
    },
    {
      id: 'editor',
      label: 'Editor',
      title: workspacePath
        ? editorOpen
          ? 'Focus editor'
          : 'Open editor'
        : 'Choose a workspace to edit files',
      open: editorOpen,
      disabled: !workspacePath && !editorOpen,
      icon: FileCode2
    }
  ];

  return (
    <div className="flex flex-col items-center gap-1">
      {items.map((item) => {
        const Icon = item.icon;
        const active = item.open && activeCompanion === item.id;
        return (
          <button
            key={item.id}
            type="button"
            className={cn(
              WORKBENCH_RAIL_BTN_CLASS,
              active && 'bg-chrome-hover-soft text-text-primary'
            )}
            title={item.title}
            aria-label={item.open ? `Focus ${item.label.toLowerCase()}` : `Open ${item.label.toLowerCase()}`}
            aria-pressed={item.open ? active : undefined}
            disabled={item.disabled}
            onClick={() => onLauncher(item.id)}
          >
            <Icon className={DOCK_TAB_ICON_CLASS} strokeWidth={DOCK_TAB_ICON_STROKE} />
          </button>
        );
      })}
    </div>
  );
}
