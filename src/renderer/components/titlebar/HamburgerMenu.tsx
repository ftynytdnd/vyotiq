/**
 * Flat hamburger action list (File / Edit / View actions, no submenus).
 */

import { useRef, useState, type ReactNode } from 'react';
import { Menu } from 'lucide-react';
import { Popover } from '../ui/Popover.js';
import { cn } from '../../lib/cn.js';
import { vyotiq } from '../../lib/ipc.js';
import { useUiStore } from '../../store/useUiStore.js';
import { useDockSearchStore } from '../../store/useDockSearchStore.js';
import type { FileMenuActions } from './menu/menus/FileMenu.js';
import type { ViewMenuActions } from './menu/menus/ViewMenu.js';
import { formatPlatformShortcut } from '../shortcuts/ShortcutsPanel.js';
import {
  CHROME_LAYER_TITLEBAR_POPOVER,
  TITLEBAR_ICON_ACTION_CLASS,
  TITLEBAR_MENU_PANEL_CLASS
} from './titlebarShared.js';
import { chromeIconActionClassName } from '../ui/SurfaceShell.js';
import { SHELL_CHROME_ICON_CLASS, SHELL_CHROME_ICON_STROKE } from '../../lib/shellIcons.js';

interface HamburgerMenuProps {
  fileActions: FileMenuActions;
  viewActions: ViewMenuActions;
}

interface MenuRowProps {
  label: string;
  shortcut?: string;
  onClick: () => void;
}

function MenuRow({ label, shortcut, onClick }: MenuRowProps) {
  return (
    <button
      type="button"
      role="menuitem"
      className="vx-btn vx-btn-quiet w-full flex-wrap items-center justify-between gap-x-3 gap-y-0.5 px-2 py-1.5 text-left text-row text-text-secondary hover:text-text-primary"
      onClick={onClick}
    >
      <span className="min-w-0 flex-1">{label}</span>
      {shortcut ? (
        <kbd className="shrink-0 whitespace-nowrap font-mono text-meta tracking-wide text-text-faint">
          {shortcut}
        </kbd>
      ) : null}
    </button>
  );
}

function MenuSeparatorRow() {
  return <div className="my-1 h-px bg-border-subtle/30" role="separator" />;
}

export function HamburgerMenu({ fileActions, viewActions }: HamburgerMenuProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dockExpanded = useUiStore((s) => s.dockExpanded);
  const toggleDock = useUiStore((s) => s.toggleDock);
  const setDockExpanded = useUiStore((s) => s.setDockExpanded);
  const setSearchOpen = useDockSearchStore((s) => s.setOpen);

  const run = (fn: () => void) => {
    fn();
    setOpen(false);
  };

  const rows: ReactNode[] = [
    <MenuRow
      key="new"
      label="New chat"
      shortcut={formatPlatformShortcut('Ctrl+N')}
      onClick={() => run(fileActions.newConversation)}
    />,
    <MenuRow
      key="open-ws"
      label="Open workspace…"
      shortcut={formatPlatformShortcut('Ctrl+O')}
      onClick={() => run(fileActions.openWorkspace)}
    />,
    <MenuRow
      key="set-ws"
      label="Set workspace path…"
      onClick={() => run(fileActions.setWorkspacePath)}
    />,
    <MenuRow
      key="settings"
      label="Settings"
      shortcut={formatPlatformShortcut('Ctrl+,')}
      onClick={() => run(fileActions.openSettings)}
    />,
    <MenuRow
      key="checkpoints"
      label="Checkpoints"
      shortcut={formatPlatformShortcut('Ctrl+Shift+H')}
      onClick={() => run(fileActions.openCheckpoints)}
    />,
    <MenuRow
      key="dock"
      label={dockExpanded ? 'Collapse navigation' : 'Expand navigation'}
      shortcut={formatPlatformShortcut('Ctrl+B')}
      onClick={() => run(toggleDock)}
    />,
    <MenuRow
      key="search"
      label="Search chats"
      shortcut={formatPlatformShortcut('Ctrl+K')}
      onClick={() =>
        run(() => {
          setDockExpanded(true);
          setSearchOpen(true);
        })
      }
    />,
    <MenuRow
      key="inspector"
      label="Context inspector"
      shortcut={formatPlatformShortcut('Ctrl+Shift+C')}
      onClick={() => run(viewActions.openContextInspector)}
    />,
    <MenuRow
      key="reload"
      label="Reload"
      shortcut={formatPlatformShortcut('Ctrl+R')}
      onClick={() => run(() => void vyotiq.window.reload())}
    />,
    <MenuRow
      key="devtools"
      label="Toggle DevTools"
      shortcut={formatPlatformShortcut('Ctrl+Shift+I')}
      onClick={() => run(() => void vyotiq.window.toggleDevTools())}
    />,
    <MenuSeparatorRow key="sep-edit" />,
    <MenuRow key="undo" label="Undo" shortcut={formatPlatformShortcut('Ctrl+Z')} onClick={() => run(() => void document.execCommand('undo'))} />,
    <MenuRow key="redo" label="Redo" shortcut={formatPlatformShortcut('Ctrl+Y')} onClick={() => run(() => void document.execCommand('redo'))} />,
    <MenuRow key="cut" label="Cut" shortcut={formatPlatformShortcut('Ctrl+X')} onClick={() => run(() => void document.execCommand('cut'))} />,
    <MenuRow key="copy" label="Copy" shortcut={formatPlatformShortcut('Ctrl+C')} onClick={() => run(() => void document.execCommand('copy'))} />,
    <MenuRow key="paste" label="Paste" shortcut={formatPlatformShortcut('Ctrl+V')} onClick={() => run(() => void document.execCommand('paste'))} />,
    <MenuRow key="select-all" label="Select all" shortcut={formatPlatformShortcut('Ctrl+A')} onClick={() => run(() => void document.execCommand('selectAll'))} />,
    <MenuSeparatorRow key="sep-quit" />,
    <MenuRow key="quit" label="Quit" onClick={() => run(fileActions.quit)} />
  ];

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label="Menu"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((v) => !v)}
        className={cn(chromeIconActionClassName, TITLEBAR_ICON_ACTION_CLASS, 'px-2 text-text-muted')}
      >
        <Menu className={SHELL_CHROME_ICON_CLASS} strokeWidth={SHELL_CHROME_ICON_STROKE} />
      </button>
      <Popover
        open={open}
        onClose={() => setOpen(false)}
        triggerRef={triggerRef}
        align="start"
        offset={6}
        zIndex={CHROME_LAYER_TITLEBAR_POPOVER}
        className={TITLEBAR_MENU_PANEL_CLASS}
      >
        <div role="menu" className="flex flex-col gap-0.5">
          {rows}
        </div>
      </Popover>
    </>
  );
}
