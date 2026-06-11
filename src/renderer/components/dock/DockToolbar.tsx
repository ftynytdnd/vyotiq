/**
 * DockToolbar — footer / collapsed-rail actions (composer-aligned h-6 pills).
 */

import { ChevronLeft, ChevronRight, Plus, Search, Settings, ArrowLeft } from 'lucide-react';
import type { ReactNode } from 'react';
import { DOCK_FOOTER_TOOLBAR_CLASS, DOCK_TAB_ICON_CLASS, DOCK_TAB_ICON_STROKE } from './dockShared.js';
import { cn } from '../../lib/cn.js';
import { chromePillClassName, chromeToolbarButtonClassName } from '../ui/SurfaceShell.js';

export interface DockToolbarProps {
  layout: 'horizontal' | 'vertical';
  searchOpen: boolean;
  onNewChat: () => void;
  onToggleSearch: () => void;
  onOpenSettings: () => void;
  onCollapse: () => void;
  collapseIcon: 'left' | 'right';
  className?: string;
  /** Larger icon slots and expand-first ordering for centered dock rail. */
  dockStyle?: boolean;
  /** Strip-only mode while settings is open — back replaces settings; no expand. */
  settingsMode?: boolean;
  onBackFromSettings?: () => void;
}

type DockActionId = 'new' | 'search' | 'settings' | 'back' | 'collapse';

interface DockActionDef {
  id: DockActionId;
  label: string;
  title: string;
  active?: boolean;
  onClick: () => void;
}

export function DockToolbar({
  layout,
  searchOpen,
  onNewChat,
  onToggleSearch,
  onOpenSettings,
  onCollapse,
  collapseIcon,
  className,
  dockStyle = false,
  settingsMode = false,
  onBackFromSettings
}: DockToolbarProps) {
  const CollapseIcon = collapseIcon === 'left' ? ChevronLeft : ChevronRight;
  const collapseLabel =
    collapseIcon === 'left' ? 'Collapse navigation' : 'Expand navigation';
  const collapseTitle =
    collapseIcon === 'left'
      ? 'Collapse navigation (Ctrl+B)'
      : 'Expand navigation (Ctrl+B)';

  const actions: DockActionDef[] = [
    {
      id: 'collapse',
      label: collapseLabel,
      title: collapseTitle,
      onClick: onCollapse
    },
    {
      id: 'new',
      label: 'New chat',
      title: 'New chat (Ctrl+N)',
      onClick: onNewChat
    },
    {
      id: 'search',
      label: 'Search chats and files',
      title: 'Search chats and files (Ctrl+K)',
      active: searchOpen,
      onClick: onToggleSearch
    },
    ...(settingsMode
      ? [
          {
            id: 'back' as const,
            label: 'Back to chat',
            title: 'Back to chat (Esc)',
            onClick: () => onBackFromSettings?.()
          }
        ]
      : [
          {
            id: 'settings' as const,
            label: 'Settings',
            title: 'Settings (Ctrl+,)',
            onClick: onOpenSettings
          }
        ])
  ];

  const order: DockActionId[] =
    layout === 'horizontal'
      ? settingsMode
        ? ['back']
        : ['new', 'search', 'settings', 'collapse']
      : dockStyle
        ? settingsMode
          ? ['back']
          : ['collapse', 'new', 'search', 'settings']
        : ['new', 'search', settingsMode ? 'back' : 'settings', 'collapse'];

  const ordered = order
    .map((id) => actions.find((a) => a.id === id))
    .filter((a): a is DockActionDef => a !== undefined);

  const iconClass = dockStyle ? 'h-4 w-4' : DOCK_TAB_ICON_CLASS;

  const renderIcon = (id: DockActionId) => {
    const stroke = DOCK_TAB_ICON_STROKE;
    switch (id) {
      case 'collapse':
        return <CollapseIcon className={iconClass} strokeWidth={stroke} />;
      case 'new':
        return <Plus className={iconClass} strokeWidth={stroke} />;
      case 'search':
        return <Search className={iconClass} strokeWidth={stroke} />;
      case 'settings':
        return <Settings className={iconClass} strokeWidth={stroke} />;
      case 'back':
        return <ArrowLeft className={iconClass} strokeWidth={stroke} />;
      default: {
        const _exhaustive: never = id;
        return _exhaustive;
      }
    }
  };

  return (
    <div
      className={cn(
        'flex shrink-0',
        layout === 'horizontal' ? DOCK_FOOTER_TOOLBAR_CLASS : 'p-0',
        layout === 'horizontal'
          ? 'items-center justify-between gap-0.5'
          : cn('flex-col items-center', dockStyle ? 'gap-1' : 'gap-0.5'),
        className
      )}
    >
      {layout === 'horizontal' ? (
        <>
          <div className="flex min-w-0 flex-1 items-center gap-0.5">
            {ordered.slice(0, -1).map((action) =>
              action.id === 'new' ? (
                <button
                  key={action.id}
                  type="button"
                  aria-label={action.label}
                  title={action.title}
                  onClick={action.onClick}
                  className={cn(chromePillClassName(false), 'gap-1 px-1.5 text-row')}
                >
                  {renderIcon(action.id)}
                  <span className="truncate">New chat</span>
                </button>
              ) : (
                <DockIconButton
                  key={action.id}
                  label={action.label}
                  title={action.title}
                  active={action.active}
                  onClick={action.onClick}
                >
                  {renderIcon(action.id)}
                </DockIconButton>
              )
            )}
          </div>
          <DockIconButton
            label={collapseLabel}
            title={collapseTitle}
            onClick={onCollapse}
          >
            {renderIcon('collapse')}
          </DockIconButton>
        </>
      ) : (
        ordered.map((action) => (
          <DockIconButton
            key={action.id}
            label={action.label}
            title={action.title}
            active={action.active}
            onClick={action.onClick}
            hoverScale={dockStyle}
            dockStyle={dockStyle}
            settingsExit={settingsMode && action.id === 'back'}
          >
            {renderIcon(action.id)}
          </DockIconButton>
        ))
      )}
    </div>
  );
}

function DockIconButton({
  label,
  title,
  active,
  onClick,
  hoverScale,
  dockStyle,
  settingsExit,
  children
}: {
  label: string;
  title: string;
  active?: boolean;
  onClick: () => void;
  hoverScale?: boolean;
  dockStyle?: boolean;
  settingsExit?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={title}
      onClick={onClick}
      className={cn(
        dockStyle ? 'vx-dock-icon-slot vx-btn vx-btn-quiet px-0' : chromeToolbarButtonClassName(active),
        !dockStyle && 'h-6 w-6 shrink-0 px-0',
        dockStyle && active && 'bg-chrome-hover-soft text-text-primary',
        settingsExit && 'text-text-secondary hover:text-text-primary',
        hoverScale && 'vx-dock-icon-hover'
      )}
    >
      {children}
    </button>
  );
}
