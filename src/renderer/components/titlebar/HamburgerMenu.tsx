/**
 * Flat hamburger action list (File / Edit / View actions, no submenus).
 */

import { useRef, useState } from 'react';
import { Popover } from '../ui/Popover.js';
import { cn } from '../../lib/cn.js';
import { vyotiq } from '../../lib/ipc.js';
import type { FileMenuActions } from './menu/menus/FileMenu.js';
import type { ViewMenuActions } from './menu/menus/ViewMenu.js';
import { formatPlatformShortcut } from '../shortcuts/ShortcutsPanel.js';
import {
  CHROME_LAYER_TITLEBAR_POPOVER,
  TITLEBAR_HAMBURGER_TRIGGER_CLASS,
  TITLEBAR_ICON_ACTION_CLASS,
  TITLEBAR_MENU_ITEM_CLASS,
  TITLEBAR_MENU_PANEL_CLASS,
  TITLEBAR_MENU_SEPARATOR_CLASS
} from './titlebarShared.js';
import { chromeIconActionClassName } from '../ui/SurfaceShell.js';
import { SHELL_CHROME_ICON_CLASS, SHELL_CHROME_ICON_STROKE } from '../../lib/shellIcons.js';

interface HamburgerMenuProps {
  fileActions: FileMenuActions;
  viewActions: ViewMenuActions;
}

type MenuEntry =
  | { type: 'separator'; key: string }
  | {
      type: 'item';
      key: string;
      label: string;
      shortcut?: string;
      action: () => void;
    };

function execEditCommand(command: string): void {
  void document.execCommand(command);
}

function HamburgerIcon() {
  const stroke = SHELL_CHROME_ICON_STROKE;
  return (
    <svg className={SHELL_CHROME_ICON_CLASS} viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M2.75 4.75h10.5" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" />
      <path d="M2.75 8h10.5" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" />
      <path d="M2.75 11.25h10.5" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" />
    </svg>
  );
}

function MenuRow({
  label,
  shortcut,
  onClick
}: {
  label: string;
  shortcut?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      className={cn('vx-btn vx-btn-quiet flex-wrap items-center', TITLEBAR_MENU_ITEM_CLASS)}
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

function buildMenuEntries(
  fileActions: FileMenuActions,
  viewActions: ViewMenuActions
): MenuEntry[] {
  return [
    {
      type: 'item',
      key: 'new',
      label: 'New chat',
      shortcut: formatPlatformShortcut('Ctrl+N'),
      action: fileActions.newConversation
    },
    {
      type: 'item',
      key: 'open-ws',
      label: 'Open workspace…',
      shortcut: formatPlatformShortcut('Ctrl+O'),
      action: fileActions.openWorkspace
    },
    {
      type: 'item',
      key: 'set-ws',
      label: 'Set workspace path…',
      action: fileActions.setWorkspacePath
    },
    {
      type: 'item',
      key: 'settings',
      label: 'Settings',
      shortcut: formatPlatformShortcut('Ctrl+,'),
      action: fileActions.openSettings
    },
    {
      type: 'item',
      key: 'checkpoints',
      label: 'Checkpoints',
      shortcut: formatPlatformShortcut('Ctrl+Shift+H'),
      action: fileActions.openCheckpoints
    },
    {
      type: 'item',
      key: 'inspector',
      label: 'Context inspector',
      shortcut: formatPlatformShortcut('Ctrl+Shift+C'),
      action: viewActions.openContextInspector
    },
    {
      type: 'item',
      key: 'reload',
      label: 'Reload',
      shortcut: formatPlatformShortcut('Ctrl+R'),
      action: () => void vyotiq.window.reload()
    },
    {
      type: 'item',
      key: 'devtools',
      label: 'Toggle DevTools',
      shortcut: formatPlatformShortcut('Ctrl+Shift+I'),
      action: () => void vyotiq.window.toggleDevTools()
    },
    { type: 'separator', key: 'sep-edit' },
    {
      type: 'item',
      key: 'undo',
      label: 'Undo',
      shortcut: formatPlatformShortcut('Ctrl+Z'),
      action: () => execEditCommand('undo')
    },
    {
      type: 'item',
      key: 'redo',
      label: 'Redo',
      shortcut: formatPlatformShortcut('Ctrl+Y'),
      action: () => execEditCommand('redo')
    },
    {
      type: 'item',
      key: 'cut',
      label: 'Cut',
      shortcut: formatPlatformShortcut('Ctrl+X'),
      action: () => execEditCommand('cut')
    },
    {
      type: 'item',
      key: 'copy',
      label: 'Copy',
      shortcut: formatPlatformShortcut('Ctrl+C'),
      action: () => execEditCommand('copy')
    },
    {
      type: 'item',
      key: 'paste',
      label: 'Paste',
      shortcut: formatPlatformShortcut('Ctrl+V'),
      action: () => execEditCommand('paste')
    },
    {
      type: 'item',
      key: 'select-all',
      label: 'Select all',
      shortcut: formatPlatformShortcut('Ctrl+A'),
      action: () => execEditCommand('selectAll')
    },
    { type: 'separator', key: 'sep-quit' },
    { type: 'item', key: 'quit', label: 'Quit', action: fileActions.quit }
  ];
}

export function HamburgerMenu({ fileActions, viewActions }: HamburgerMenuProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuId = 'titlebar-hamburger-menu';
  const entries = buildMenuEntries(fileActions, viewActions);

  const run = (fn: () => void) => {
    fn();
    setOpen(false);
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label="Menu"
        aria-expanded={open}
        aria-haspopup="menu"
        aria-controls={menuId}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          chromeIconActionClassName,
          TITLEBAR_ICON_ACTION_CLASS,
          TITLEBAR_HAMBURGER_TRIGGER_CLASS,
          'px-1 text-text-muted'
        )}
      >
        <HamburgerIcon />
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
        <div id={menuId} role="menu" className="flex flex-col gap-0.5">
          {entries.map((entry) =>
            entry.type === 'separator' ? (
              <div key={entry.key} className={TITLEBAR_MENU_SEPARATOR_CLASS} role="separator" />
            ) : (
              <MenuRow
                key={entry.key}
                label={entry.label}
                shortcut={entry.shortcut}
                onClick={() => run(entry.action)}
              />
            )
          )}
        </div>
      </Popover>
    </>
  );
}
