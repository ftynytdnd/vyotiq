/**

 * DockToolbar — titlebar-integrated dock actions (horizontal icon row).

 */



import { ChevronLeft, ChevronRight, Plus, Search, Settings, ArrowLeft, CalendarClock } from 'lucide-react';

import type { ReactNode } from 'react';

import { DOCK_TAB_ICON_CLASS, DOCK_TAB_ICON_STROKE } from './dockShared.js';

import { cn } from '../../lib/cn.js';

import { TITLEBAR_ICON_ACTION_CLASS } from '../titlebar/titlebarShared.js';



export interface DockToolbarProps {
  searchOpen: boolean;
  schedulesOpen: boolean;
  enabledScheduleCount: number;
  onNewChat: () => void;
  onToggleSearch: () => void;
  onToggleSchedules: () => void;

  onCollapse: () => void;

  collapseIcon: 'left' | 'right';

  className?: string;

  /** Highlights the collapse control while the dock flyout is open. */

  dockExpanded?: boolean;

  /** Strip-only mode while settings is open — back replaces settings; no expand. */

  settingsMode?: boolean;

  onBackFromSettings?: () => void;

}



type DockActionId = 'new' | 'search' | 'schedules' | 'settings' | 'back' | 'collapse';



interface DockActionDef {

  id: DockActionId;

  label: string;

  title: string;

  active?: boolean;

  onClick: () => void;

}



export function DockToolbar({
  searchOpen,
  schedulesOpen,
  enabledScheduleCount,
  onNewChat,
  onToggleSearch,
  onToggleSchedules,
  onCollapse,

  collapseIcon,

  className,

  dockExpanded = false,

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

  const showSchedules = schedulesOpen || enabledScheduleCount > 0;



  const actions: DockActionDef[] = [

    {

      id: 'collapse',

      label: collapseLabel,

      title: collapseTitle,

      active: dockExpanded,

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
      label: 'Search skills, chats, messages, and files',
      title: 'Search skills, chats, messages, and files (Ctrl+K)',
      active: searchOpen,
      onClick: onToggleSearch
    },
    {
      id: 'schedules',
      label: 'Scheduled runs',
      title: 'Scheduled runs',
      active: schedulesOpen,
      onClick: onToggleSchedules
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

      : [])

  ];



  const order: DockActionId[] = settingsMode
    ? ['back']
    : dockExpanded
      ? ['collapse', ...(showSchedules ? (['schedules'] as const) : [])]
      : showSchedules
        ? (['collapse', 'schedules'] as const)
        : ['collapse'];



  const ordered = order

    .map((id) => actions.find((a) => a.id === id))

    .filter((a): a is DockActionDef => a !== undefined);



  const renderIcon = (id: DockActionId) => {

    const stroke = DOCK_TAB_ICON_STROKE;

    switch (id) {

      case 'collapse':

        return <CollapseIcon className={DOCK_TAB_ICON_CLASS} strokeWidth={stroke} />;

      case 'new':

        return <Plus className={DOCK_TAB_ICON_CLASS} strokeWidth={stroke} />;

      case 'search':
        return <Search className={DOCK_TAB_ICON_CLASS} strokeWidth={stroke} />;
      case 'schedules':
        return (
          <span className="relative inline-flex">
            <CalendarClock className={DOCK_TAB_ICON_CLASS} strokeWidth={stroke} />
            {enabledScheduleCount > 0 ? (
              <span
                className="absolute -right-1 -top-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-accent-gold px-0.5 font-mono text-meta leading-none text-surface-base"
                aria-hidden
              >
                {enabledScheduleCount > 9 ? '9+' : enabledScheduleCount}
              </span>
            ) : null}
          </span>
        );
      case 'settings':

        return <Settings className={DOCK_TAB_ICON_CLASS} strokeWidth={stroke} />;

      case 'back':

        return <ArrowLeft className={DOCK_TAB_ICON_CLASS} strokeWidth={stroke} />;

      default: {

        const _exhaustive: never = id;

        return _exhaustive;

      }

    }

  };



  return (

    <div className={cn('flex shrink-0 items-center gap-0.5 p-0', className)}>

      {ordered.map((action) => (

        <DockIconButton

          key={action.id}

          label={action.label}

          title={action.title}

          active={action.active}

          emphasis={action.id === 'new'}

          onClick={action.onClick}

          settingsExit={settingsMode && action.id === 'back'}

        >

          {renderIcon(action.id)}

        </DockIconButton>

      ))}

    </div>

  );

}



function DockIconButton({

  label,

  title,

  active,

  emphasis,

  onClick,

  settingsExit,

  children

}: {

  label: string;

  title: string;

  active?: boolean;

  emphasis?: boolean;

  onClick: () => void;

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

        TITLEBAR_ICON_ACTION_CLASS,

        'vx-btn vx-btn-quiet px-1',

        emphasis ? 'vx-titlebar-action--emphasis' : 'text-text-muted',

        active && 'bg-chrome-hover-soft text-text-primary',

        settingsExit && 'text-text-secondary hover:text-text-primary'

      )}

    >

      {children}

    </button>

  );

}

