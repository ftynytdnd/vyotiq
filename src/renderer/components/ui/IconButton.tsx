/**
 * IconButton — square hover-target for an icon-only action. Used for
 * the Modal close button today; intentionally kept generic so future
 * icon-only surfaces (toolbar overflow menus, kebab actions on
 * cards) can adopt it without re-rolling the same shape.
 *
 * Sizing follows the same rhythm as the rest of the renderer: 32px
 * (`h-8 w-8`) for dialog headers and similar destination surfaces
 * where hit-area generosity matters; smaller inline icon affordances
 * (dock tab actions, composer attachment count) compose plain `<button>`
 * with the local hover-reveal opacity pattern instead.
 *
 * `active` paints the same `bg-surface-hover` tint the rest of the
 * codebase uses for "open / pressed" states so toggle-style icon
 * buttons stay coherent with `PermissionsMenu` and the dock
 * toolbar buttons.
 */
import React from 'react';
import { cn } from '../../lib/cn.js';

interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  active?: boolean;
}

export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  function IconButton({ className, label, active, children, ...rest }, ref) {
    return (
      <button
        ref={ref}
        type="button"
        aria-label={label}
        aria-pressed={active ?? undefined}
        title={label}
        className={cn(
          'app-no-drag inline-flex h-8 w-8 items-center justify-center rounded-inner',
          'text-text-muted transition-colors duration-150',
          'hover:bg-surface-hover hover:text-text-primary',
          'disabled:cursor-not-allowed disabled:opacity-50',
          active && 'bg-surface-hover text-text-primary',
          className
        )}
        {...rest}
      >
        {children}
      </button>
    );
  }
);
