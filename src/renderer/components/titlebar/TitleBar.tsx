/**
 * Frameless title bar. Layout:
 *
 *   [ MenuBar ] [ workspace ]     …     [ settings ] [ help ] [ window controls ]
 *   ←─ interactive ─→   ←── drag ──→   ←── interactive ──→
 *
 * The workspace label is the primary at-a-glance context indicator.
 * Navigation lives in the bottom dock; settings and shortcuts live
 * in the title bar and secondary zone.
 */

import { useMemo, useRef, useState, type ReactNode } from 'react';
import { Folder, HelpCircle, Settings } from 'lucide-react';
import { WindowControls } from './WindowControls.js';
import { MenuBar, type FileMenuActions } from './menu/index.js';
import { type ViewMenuActions } from './menu/menus/ViewMenu.js';
import { Popover } from '../ui/Popover.js';
import { ShortcutsPanel, platformAltKey, platformModKey } from '../shortcuts/ShortcutsPanel.js';
import { useWorkspaceStore } from '../../store/useWorkspaceStore.js';
import { cn } from '../../lib/cn.js';

export interface TitleBarProps {
  fileActions: FileMenuActions;
  viewActions: ViewMenuActions;
  onOpenSettings: () => void;
}

export function TitleBar({ fileActions, viewActions, onOpenSettings }: TitleBarProps) {
  const activeWorkspaceLabel = useWorkspaceStore(
    (s) => s.list.find((w) => w.id === s.activeId)?.label ?? null
  );
  const activeWorkspacePath = useWorkspaceStore(
    (s) => s.list.find((w) => w.id === s.activeId)?.path ?? null
  );

  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const helpButtonRef = useRef<HTMLButtonElement>(null);
  const mod = useMemo(platformModKey, []);
  const alt = useMemo(platformAltKey, []);

  return (
    <header className="app-drag flex h-8 select-none items-center border-b border-border-subtle/10 bg-surface-base text-row">
      <div className="app-no-drag flex items-stretch px-1">
        <MenuBar fileActions={fileActions} viewActions={viewActions} />
      </div>
      {activeWorkspaceLabel && (
        <div
          className={cn(
            'app-no-drag ml-2 flex min-w-0 max-w-[32ch] items-center gap-1.5',
            'rounded-inner bg-surface-hover/30 px-2 py-0.5 text-row text-text-muted'
          )}
          title={activeWorkspacePath ?? undefined}
        >
          <Folder className="h-3 w-3 shrink-0 text-text-faint" strokeWidth={2} />
          <span className="truncate">{activeWorkspaceLabel}</span>
        </div>
      )}
      <div className="flex-1" />
      <div className="app-no-drag flex items-center gap-0.5 pr-1">
        <TitleBarIconButton
          label="Settings"
          title="Settings (Ctrl+,)"
          onClick={onOpenSettings}
        >
          <Settings className="h-3.5 w-3.5" strokeWidth={2} />
        </TitleBarIconButton>
        <button
          ref={helpButtonRef}
          type="button"
          aria-label="Keyboard shortcuts"
          title="Keyboard shortcuts"
          aria-expanded={shortcutsOpen}
          onClick={() => setShortcutsOpen((v) => !v)}
          className={cn(
            'inline-flex h-6 w-6 items-center justify-center rounded-inner',
            'text-text-muted transition-colors duration-150',
            'hover:bg-surface-hover hover:text-text-primary',
            shortcutsOpen && 'bg-surface-hover text-text-primary'
          )}
        >
          <HelpCircle className="h-3.5 w-3.5" strokeWidth={2} />
        </button>
        <Popover
          open={shortcutsOpen}
          onClose={() => setShortcutsOpen(false)}
          triggerRef={helpButtonRef}
          align="end"
          offset={8}
          className="elev-1 w-72 rounded-card bg-surface-overlay p-2.5"
        >
          <ShortcutsPanel mod={mod} alt={alt} />
        </Popover>
      </div>
      <WindowControls />
    </header>
  );
}

function TitleBarIconButton({
  label,
  title,
  onClick,
  children
}: {
  label: string;
  title: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={title}
      onClick={onClick}
      className={cn(
        'inline-flex h-6 w-6 items-center justify-center rounded-inner',
        'text-text-muted transition-colors duration-150',
        'hover:bg-surface-hover hover:text-text-primary'
      )}
    >
      {children}
    </button>
  );
}
