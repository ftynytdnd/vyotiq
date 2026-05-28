/**
 * DockToolbar — footer / collapsed-rail actions (composer-aligned h-6 pills).
 */

import { ChevronLeft, ChevronRight, Plus, Search } from 'lucide-react';
import type { ReactNode } from 'react';
import { DOCK_FOOTER_TOOLBAR_CLASS, DOCK_TAB_ICON_CLASS, DOCK_TAB_ICON_STROKE } from './dockShared.js';
import { cn } from '../../lib/cn.js';
import { chromePillClassName, chromeToolbarButtonClassName } from '../ui/SurfaceShell.js';

export interface DockToolbarProps {
  layout: 'horizontal' | 'vertical';
  searchOpen: boolean;
  onNewChat: () => void;
  onToggleSearch: () => void;
  onCollapse: () => void;
  collapseIcon: 'left' | 'right';
  className?: string;
}

export function DockToolbar({
  layout,
  searchOpen,
  onNewChat,
  onToggleSearch,
  onCollapse,
  collapseIcon,
  className
}: DockToolbarProps) {
  const CollapseIcon = collapseIcon === 'left' ? ChevronLeft : ChevronRight;

  return (
    <div
      className={cn(
        'flex shrink-0',
        layout === 'horizontal' ? DOCK_FOOTER_TOOLBAR_CLASS : 'p-0',
        layout === 'horizontal'
          ? 'items-center justify-between gap-0.5'
          : 'flex-col items-center gap-0.5',
        className
      )}
    >
      {layout === 'horizontal' ? (
        <>
          <div className="flex min-w-0 flex-1 items-center gap-0.5">
            <button
              type="button"
              aria-label="New chat"
              title="New chat (Ctrl+N)"
              onClick={onNewChat}
              className={cn(chromePillClassName(false), 'gap-1 px-1.5 text-row')}
            >
              <Plus className={DOCK_TAB_ICON_CLASS} strokeWidth={DOCK_TAB_ICON_STROKE} />
              <span className="truncate">New chat</span>
            </button>
            <DockIconButton
              label="Search chats"
              title="Search chats (Ctrl+K)"
              active={searchOpen}
              onClick={onToggleSearch}
            >
              <Search className={DOCK_TAB_ICON_CLASS} strokeWidth={DOCK_TAB_ICON_STROKE} />
            </DockIconButton>
          </div>
          <DockIconButton
            label="Collapse dock"
            title="Toggle dock (Ctrl+B)"
            onClick={onCollapse}
          >
            <CollapseIcon className={DOCK_TAB_ICON_CLASS} strokeWidth={DOCK_TAB_ICON_STROKE} />
          </DockIconButton>
        </>
      ) : (
        <>
          <DockIconButton label="New chat" title="New chat (Ctrl+N)" onClick={onNewChat}>
            <Plus className={DOCK_TAB_ICON_CLASS} strokeWidth={DOCK_TAB_ICON_STROKE} />
          </DockIconButton>
          <DockIconButton
            label="Search chats"
            title="Search chats (Ctrl+K)"
            active={searchOpen}
            onClick={onToggleSearch}
          >
            <Search className={DOCK_TAB_ICON_CLASS} strokeWidth={DOCK_TAB_ICON_STROKE} />
          </DockIconButton>
          <DockIconButton
            label="Expand dock"
            title="Toggle dock (Ctrl+B)"
            onClick={onCollapse}
          >
            <CollapseIcon className={DOCK_TAB_ICON_CLASS} strokeWidth={DOCK_TAB_ICON_STROKE} />
          </DockIconButton>
        </>
      )}
    </div>
  );
}

function DockIconButton({
  label,
  title,
  active,
  onClick,
  children
}: {
  label: string;
  title: string;
  active?: boolean;
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
        chromeToolbarButtonClassName(active),
        'h-6 w-6 shrink-0 px-0'
      )}
    >
      {children}
    </button>
  );
}
