/**
 * Compact app menu — workspace actions, settings, and quit.
 */

import { useRef, useState } from 'react';
import { Popover } from '../ui/Popover.js';
import { cn } from '../../lib/cn.js';
import type { FileMenuActions } from './menu/menus/FileMenu.js';
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

function buildMenuEntries(fileActions: FileMenuActions): MenuEntry[] {
  const chatEnabled = fileActions.chatActionsEnabled !== false;
  const chatEntries: MenuEntry[] = chatEnabled
    ? [
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
        ...(fileActions.openScheduledRuns
          ? [
              {
                type: 'item' as const,
                key: 'schedules',
                label: 'Scheduled runs',
                action: fileActions.openScheduledRuns
              }
            ]
          : []),
        { type: 'separator', key: 'sep-settings' }
      ]
    : [];

  return [
    ...chatEntries,
    {
      type: 'item',
      key: 'settings',
      label: 'Settings',
      shortcut: formatPlatformShortcut('Ctrl+,'),
      action: () => fileActions.openSettings()
    },
    { type: 'separator', key: 'sep-quit' },
    { type: 'item', key: 'quit', label: 'Quit', action: fileActions.quit }
  ];
}

export function HamburgerMenu({ fileActions }: HamburgerMenuProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuId = 'titlebar-hamburger-menu';
  const entries = buildMenuEntries(fileActions);

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
