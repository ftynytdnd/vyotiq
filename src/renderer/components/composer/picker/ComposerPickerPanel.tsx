/**
 * Shared shell for composer popover pickers (mention, skill slash, etc.).
 */

import type { ReactNode, RefObject, KeyboardEventHandler } from 'react';
import { appPopoverPanelClassName } from '../../ui/SurfaceShell.js';
import { cn } from '../../../lib/cn.js';

export function ComposerPickerHead({
  icon,
  title,
  subtitle
}: {
  icon: ReactNode;
  title: ReactNode;
  subtitle: string;
}) {
  return (
    <div className="vx-mention-picker-head shrink-0 flex items-center gap-2 border-b border-border-subtle/30 px-2 py-1.5">
      {icon}
      <div className="min-w-0 flex-1">
        <div className="truncate font-mono text-row text-text-primary">{title}</div>
        <div className="truncate text-meta text-text-faint">{subtitle}</div>
      </div>
    </div>
  );
}

export function ComposerPickerFoot({ children }: { children: ReactNode }) {
  return (
    <div className="vx-mention-picker-foot shrink-0 border-t border-border-subtle/30 px-2 py-1">
      {children}
    </div>
  );
}

export interface ComposerPickerShellProps {
  className?: string;
  head: ReactNode;
  foot: ReactNode;
  listRef?: RefObject<HTMLDivElement | null>;
  listAriaLabel: string;
  listAriaBusy?: boolean;
  activeDescendantId?: string;
  onListKeyDown?: KeyboardEventHandler<HTMLDivElement>;
  listTabIndex?: number;
  children: ReactNode;
}

export function ComposerPickerShell({
  className,
  head,
  foot,
  listRef,
  listAriaLabel,
  listAriaBusy,
  activeDescendantId,
  onListKeyDown,
  listTabIndex,
  children
}: ComposerPickerShellProps) {
  return (
    <div
      className={cn(
        appPopoverPanelClassName,
        'vx-mention-picker vx-composer-picker-panel flex h-full max-h-full min-h-0 w-full min-w-0 flex-col',
        className
      )}
      role="presentation"
    >
      {head}
      <div
        ref={listRef}
        className="vx-mention-picker-scroll vx-composer-picker-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain px-0.5 py-0.5"
        role="listbox"
        aria-label={listAriaLabel}
        aria-busy={listAriaBusy || undefined}
        aria-activedescendant={activeDescendantId}
        tabIndex={listTabIndex}
        onKeyDown={onListKeyDown}
        onWheel={(e) => e.stopPropagation()}
      >
        {children}
      </div>
      {foot}
    </div>
  );
}
