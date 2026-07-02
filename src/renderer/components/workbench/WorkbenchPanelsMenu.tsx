/**

 * Compact workbench launcher — single titlebar control with panel picker popover.

 */



import { useCallback, useRef } from 'react';

import { FileCode2, GitBranch, Globe, LayoutPanelLeft, TerminalSquare } from 'lucide-react';

import { useTerminalStore } from '../../store/useTerminalStore.js';

import { useBrowserStore } from '../../store/useBrowserStore.js';

import { useEditorStore } from '../../store/useEditorStore.js';

import { useSourceControlStore } from '../../store/useSourceControlStore.js';

import { useWorkspaceStore } from '../../store/useWorkspaceStore.js';

import { useUiStore } from '../../store/useUiStore.js';

import { useWorkbenchPanelsStore } from '../../store/useWorkbenchPanelsStore.js';

import {

  focusWorkbenchTab,

  resolveCompanionTab,

  closeTerminalPanel,

  closeBrowserPanel,

  closeEditorPanel

} from './workbenchShared.js';

import { DOCK_TAB_ICON_CLASS, DOCK_TAB_ICON_STROKE } from '../dock/dockShared.js';

import { TITLEBAR_ICON_ACTION_CLASS } from '../titlebar/titlebarShared.js';

import { Popover } from '../ui/Popover.js';

import { chromePopoverPanelClassName } from '../ui/SurfaceShell.js';

import { readTitlebarInsetPx } from '../ui/popoverPosition.js';

import { CHROME_LAYER_TITLEBAR_POPOVER } from '../titlebar/titlebarShared.js';

import { cn } from '../../lib/cn.js';

import { formatKeybindingHint } from '../../lib/formatKeybindingHint.js';

import { isMacPlatform, resolveKeybindings } from '../../lib/resolveKeybindings.js';

import { useSettingsStore } from '../../store/useSettingsStore.js';



type LauncherId = 'terminal' | 'browser' | 'editor' | 'source-control';



interface PanelRow {

  id: LauncherId;

  label: string;

  hint: string;

  open: boolean;

  focused: boolean;

  disabled?: boolean;

  icon: typeof TerminalSquare;

}



export function WorkbenchPanelsMenu() {

  const open = useWorkbenchPanelsStore((s) => s.open);

  const setOpen = useWorkbenchPanelsStore((s) => s.setOpen);

  const triggerRef = useRef<HTMLButtonElement>(null);



  const activeWorkspaceId = useWorkspaceStore((s) => s.activeId);

  const workspacePath = useWorkspaceStore((s) => s.info.path);

  const workbenchTab = useUiStore((s) => s.workbenchTab);

  const activeCompanion = resolveCompanionTab(workbenchTab);



  const terminalOpen = useTerminalStore((s) => s.open);

  const browserOpen = useBrowserStore((s) => s.open);

  const editorOpen = useEditorStore((s) => s.open);

  const sourceControlOpen = useSourceControlStore((s) => s.open);



  const openTerminal = useTerminalStore((s) => s.openPanel);

  const openBrowser = useBrowserStore((s) => s.openPanel);

  const openSourceControl = useSourceControlStore((s) => s.openPanel);



  const onLauncher = useCallback(

    (id: LauncherId) => {

      setOpen(false);

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

      if (id === 'source-control') {

        if (sourceControlOpen) {

          if (focused) {

            useSourceControlStore.getState().close();

            return;

          }

          focusWorkbenchTab('source-control');

          return;

        }

        if (activeWorkspaceId) void openSourceControl(activeWorkspaceId);

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

    [

      activeWorkspaceId,

      browserOpen,

      editorOpen,

      openBrowser,

      openTerminal,

      openSourceControl,

      terminalOpen,

      sourceControlOpen,

      workbenchTab,

      setOpen

    ]

  );



  const rows: PanelRow[] = [

    {

      id: 'terminal',

      label: 'Terminal',

      hint: activeWorkspaceId ? 'Ctrl+`' : 'Needs workspace',

      open: terminalOpen,

      focused: terminalOpen && activeCompanion === 'terminal',

      disabled: !activeWorkspaceId && !terminalOpen,

      icon: TerminalSquare

    },

    {

      id: 'browser',

      label: 'Browser',

      hint: 'In-app web view',

      open: browserOpen,

      focused: browserOpen && activeCompanion === 'browser',

      icon: Globe

    },

    {

      id: 'source-control',

      label: 'Source control',

      hint: activeWorkspaceId ? 'Mod+Alt+G' : 'Needs workspace',

      open: sourceControlOpen,

      focused: sourceControlOpen && activeCompanion === 'source-control',

      disabled: !activeWorkspaceId && !sourceControlOpen,

      icon: GitBranch

    },

    {

      id: 'editor',

      label: 'Editor',

      hint: workspacePath ? 'File tabs' : 'Needs workspace',

      open: editorOpen,

      focused: editorOpen && activeCompanion === 'editor',

      disabled: !workspacePath && !editorOpen,

      icon: FileCode2

    }

  ];



  const anyOpen = terminalOpen || browserOpen || editorOpen || sourceControlOpen;

  const anyFocused = rows.some((r) => r.focused);



  const keybindingOverrides = useSettingsStore((s) => s.settings.ui?.keybindings);

  const panelsHint = formatKeybindingHint(

    resolveKeybindings(keybindingOverrides, isMacPlatform()).companionPanels,

    isMacPlatform()

  );

  const sourceHint = formatKeybindingHint(

    resolveKeybindings(keybindingOverrides, isMacPlatform()).sourceControl,

    isMacPlatform()

  );



  return (

    <>

      <button

        ref={triggerRef}

        type="button"

        className={cn(

          TITLEBAR_ICON_ACTION_CLASS,

          'vx-btn vx-btn-quiet relative px-1 text-text-muted',

          anyFocused && 'vx-titlebar-workbench-btn--focused',

          anyOpen && !anyFocused && 'vx-titlebar-workbench-btn--open'

        )}

        aria-label="Companion panels"

        aria-expanded={open}

        aria-haspopup="menu"

        title={`Terminal, browser, editor, and source control (${panelsHint}, ${sourceHint})`}

        onClick={() => setOpen(!open)}

      >

        <LayoutPanelLeft className={DOCK_TAB_ICON_CLASS} strokeWidth={DOCK_TAB_ICON_STROKE} />

        {anyOpen ? (

          <span

            className="absolute right-0.5 top-0.5 size-1.5 rounded-full bg-accent-gold"

            aria-hidden

          />

        ) : null}

      </button>

      <Popover

        open={open}

        onClose={() => setOpen(false)}

        triggerRef={triggerRef}

        align="end"

        preferSide="bottom"

        anchorStrict

        widthMode="content"

        fitMaxWidth={280}

        zIndex={CHROME_LAYER_TITLEBAR_POPOVER}

        collisionPadding={{ top: readTitlebarInsetPx(), right: 8, left: 8, bottom: 8 }}

        className={cn(chromePopoverPanelClassName, 'vx-workbench-panels-menu min-w-[11rem] p-1')}

      >

        <div role="menu" aria-label="Companion panels" className="flex flex-col gap-0.5">

          {rows.map((row) => {

            const Icon = row.icon;

            return (

              <button

                key={row.id}

                type="button"

                role="menuitem"

                disabled={row.disabled}

                className={cn(

                  'vx-btn vx-btn-quiet flex w-full items-center gap-2 rounded-inner px-2 py-1.5 text-left text-row',

                  row.focused

                    ? 'bg-chrome-hover-soft text-text-primary'

                    : row.open

                      ? 'text-text-secondary'

                      : 'text-text-muted'

                )}

                onClick={() => onLauncher(row.id)}

              >

                <Icon className={DOCK_TAB_ICON_CLASS} strokeWidth={DOCK_TAB_ICON_STROKE} aria-hidden />

                <span className="min-w-0 flex-1 truncate">{row.label}</span>

                <span className="shrink-0 font-mono text-meta text-text-faint">{row.hint}</span>

              </button>

            );

          })}

        </div>

      </Popover>

    </>

  );

}

