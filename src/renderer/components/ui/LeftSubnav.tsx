/**
 * Vertical left sub-navigation for settings-style panels.
 */

import type { ReactNode } from 'react';
import { cn } from '../../lib/cn.js';

export interface LeftSubnavItem<T extends string = string> {
  id: T;
  label: ReactNode;
  icon?: ReactNode;
  disabled?: boolean;
  tabId?: string;
  panelId?: string;
}

interface LeftSubnavProps<T extends string> {
  items: ReadonlyArray<LeftSubnavItem<T>>;
  value: T;
  onChange: (next: T) => void;
  ariaLabel: string;
  className?: string;
  footer?: ReactNode;
}

export function LeftSubnav<T extends string>({
  items,
  value,
  onChange,
  ariaLabel,
  className,
  footer
}: LeftSubnavProps<T>) {
  return (
    <nav
      role="tablist"
      aria-label={ariaLabel}
      className={cn('vx-left-subnav scrollbar-stealth', className)}
    >
      {items.map((item) => {
        const active = item.id === value;
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            id={item.tabId}
            aria-selected={active}
            aria-controls={item.panelId}
            disabled={item.disabled}
            data-active={active ? 'true' : 'false'}
            onClick={() => !item.disabled && onChange(item.id)}
            className={cn(
              'vx-left-subnav-item app-no-drag',
              item.disabled && 'cursor-not-allowed opacity-50'
            )}
          >
            {item.icon}
            <span className="min-w-0 truncate">{item.label}</span>
          </button>
        );
      })}
      {footer}
    </nav>
  );
}

interface LeftSubnavLayoutProps {
  nav: ReactNode;
  children: ReactNode;
  aside?: ReactNode;
  className?: string;
  contentClassName?: string;
}

export function LeftSubnavLayout({
  nav,
  children,
  aside,
  className,
  contentClassName
}: LeftSubnavLayoutProps) {
  return (
    <div className={cn('vx-left-subnav-layout min-h-0 flex-1', className)}>
      <div className="vx-left-subnav-rail shrink-0">
        {nav}
        {aside}
      </div>
      <div className={cn('vx-left-subnav-content min-h-0 flex-1', contentClassName)}>{children}</div>
    </div>
  );
}
