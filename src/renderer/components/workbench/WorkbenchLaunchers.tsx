/**

 * Workbench launchers — open terminal, browser, and editor companion panels.

 */



import { useCallback } from 'react';

import { FileCode2, Globe, TerminalSquare } from 'lucide-react';

import { useTerminalStore } from '../../store/useTerminalStore.js';

import { useBrowserStore } from '../../store/useBrowserStore.js';

import { useWorkspaceStore } from '../../store/useWorkspaceStore.js';

import { useUiStore } from '../../store/useUiStore.js';

import {

  focusWorkbenchTab,

  resolveCompanionTab,

  closeTerminalPanel,

  closeBrowserPanel,

  closeEditorPanel

} from './workbenchShared.js';

import { DOCK_TAB_ICON_CLASS, DOCK_TAB_ICON_STROKE } from '../dock/dockShared.js';

import { TITLEBAR_ICON_ACTION_CLASS } from '../titlebar/titlebarShared.js';

import { cn } from '../../lib/cn.js';



export interface WorkbenchLaunchersProps {

  terminalOpen: boolean;

  browserOpen: boolean;

  editorOpen: boolean;

  /** Titlebar tray — open panels stay visible with active/focus tiers. */

  titlebarMode?: boolean;

}



type LauncherId = 'terminal' | 'browser' | 'editor';



export function WorkbenchLaunchers({

  terminalOpen,

  browserOpen,

  editorOpen,

  titlebarMode = false

}: WorkbenchLaunchersProps) {

  const activeWorkspaceId = useWorkspaceStore((s) => s.activeId);

  const workspacePath = useWorkspaceStore((s) => s.info.path);

  const workbenchTab = useUiStore((s) => s.workbenchTab);

  const activeCompanion = resolveCompanionTab(workbenchTab);



  const openTerminal = useTerminalStore((s) => s.openPanel);

  const openBrowser = useBrowserStore((s) => s.openPanel);



  const onLauncher = useCallback(

    (id: LauncherId) => {

      const focused = resolveCompanionTab(workbenchTab) === id;

      if (id === 'terminal') {

        if (terminalOpen) {

          if (focused) {

            closeTerminalPanel();

            return;

          }

          focusWorkbenchTab('terminal');

          return;

        }

        if (activeWorkspaceId) void openTerminal(activeWorkspaceId);

        return;

      }

      if (id === 'browser') {

        if (browserOpen) {

          if (focused) {

            closeBrowserPanel();

            return;

          }

          focusWorkbenchTab('browser');

          return;

        }

        void openBrowser();

        return;

      }

      if (editorOpen) {

        if (focused) {

          closeEditorPanel();

          return;

        }

        focusWorkbenchTab('editor');

        return;

      }

      useUiStore.getState().setDockExpanded(true);

      useUiStore.getState().setDockPanelTab('files');

    },

    [activeWorkspaceId, browserOpen, editorOpen, openBrowser, openTerminal, terminalOpen, workbenchTab]

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

          ? activeCompanion === 'terminal'

            ? 'Close terminal (Ctrl+`)'

            : 'Focus terminal'

          : 'Open terminal (Ctrl+`)'

        : 'Choose a workspace to open a terminal',

      open: terminalOpen,

      disabled: !activeWorkspaceId && !terminalOpen,

      icon: TerminalSquare

    },

    {

      id: 'browser',

      label: 'Browser',

      title:

        browserOpen

          ? activeCompanion === 'browser'

            ? 'Close browser (Ctrl+W)'

            : 'Focus browser'

          : 'Open browser',

      open: browserOpen,

      icon: Globe

    },

    {

      id: 'editor',

      label: 'Editor',

      title: workspacePath

        ? editorOpen

          ? activeCompanion === 'editor'

            ? 'Close editor (Ctrl+W)'

            : 'Focus editor'

          : 'Open files in dock (Ctrl+B)'

        : 'Choose a workspace to edit files',

      open: editorOpen,

      disabled: !workspacePath && !editorOpen,

      icon: FileCode2

    }

  ];



  const btnClass = cn(

    TITLEBAR_ICON_ACTION_CLASS,

    'vx-btn vx-btn-quiet text-text-muted',

    titlebarMode && 'vx-titlebar-workbench-btn'

  );



  return (

    <div className="flex items-center gap-0.5">

      {items.map((item) => {

        const Icon = item.icon;

        const focused = item.open && activeCompanion === item.id;

        const open = item.open;

        return (

          <button

            key={item.id}

            type="button"

            className={cn(

              btnClass,

              titlebarMode

                ? focused

                  ? 'vx-titlebar-workbench-btn--focused'

                  : open

                    ? 'vx-titlebar-workbench-btn--open'

                    : undefined

                : focused && 'bg-chrome-hover-soft text-text-primary'

            )}

            title={item.title}

            aria-label={

              item.open

                ? focused

                  ? `Close ${item.label.toLowerCase()}`

                  : `Focus ${item.label.toLowerCase()}`

                : item.id === 'editor'

                  ? 'Open files to edit'

                  : `Open ${item.label.toLowerCase()}`

            }

            aria-pressed={open ? focused : undefined}

            data-open={open ? 'true' : undefined}

            data-focused={focused ? 'true' : undefined}

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

