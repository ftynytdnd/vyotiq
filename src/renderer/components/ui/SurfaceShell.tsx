/**
 * SurfaceShell — canonical bordered inset shell matching composer/dock footer
 * chrome. Centralizes the long `cn(...)` strings used across ChatFooter,
 * timeline rows, and secondary panels.
 */

import {
  type ElementType,
  type HTMLAttributes,
  type ReactNode
} from 'react';
import { cn } from '../../lib/cn.js';

export type SurfaceShellPadding = 'none' | 'compact' | 'content' | 'nested';

/** Base shell — matches ChatFooter composer/dock shells. */
export const surfaceShellClassName = cn(
  'overflow-hidden rounded-inner',
  'border border-border-subtle/18 bg-surface-raised/10',
  'shadow-[inset_0_1px_0_0_rgba(255,255,255,0.025)]'
);

/** Optional focus-within glow for interactive shells (composer input area). */
export const surfaceShellFocusClassName = cn(
  'transition-[border-color,box-shadow] duration-150',
  'focus-within:border-border-subtle/35',
  'focus-within:shadow-[inset_0_1px_0_0_rgba(255,255,255,0.04),0_0_0_1px_rgba(255,255,255,0.02)]'
);

const PADDING_CLASS: Record<SurfaceShellPadding, string> = {
  none: '',
  compact: 'px-2 py-1',
  content: 'px-3 py-2',
  nested: 'px-2.5 py-1.5'
};

export function surfaceShellInnerClassName(
  padding: SurfaceShellPadding = 'none'
): string {
  return PADDING_CLASS[padding];
}

/** List container inside a shell (checkpoints, inspector lists). */
export const surfaceListClassName = cn(
  surfaceShellClassName,
  'flex flex-col gap-0.5 overflow-y-auto p-1'
);

export interface SurfaceShellProps extends HTMLAttributes<HTMLElement> {
  as?: ElementType;
  children?: ReactNode;
  /** When `as="button"`, forwarded to the native button `type`. */
  type?: 'button' | 'submit' | 'reset';
  /** Enable composer-style focus-within border glow. */
  focusGlow?: boolean;
  /** Inner padding preset applied to children wrapper. */
  padding?: SurfaceShellPadding;
  /** When true, wraps children in an inner div with padding. */
  padded?: boolean;
  className?: string;
}

export function SurfaceShell({
  as: Tag = 'div',
  children,
  focusGlow = false,
  padding = 'none',
  padded = false,
  className,
  type,
  ...rest
}: SurfaceShellProps) {
  const shellClass = cn(
    'surface-shell',
    surfaceShellClassName,
    focusGlow && cn('surface-shell-focus', surfaceShellFocusClassName),
    className
  );
  const tagProps =
    Tag === 'button'
      ? { type: type ?? 'button', ...rest }
      : rest;

  if (padded && padding !== 'none') {
    return (
      <Tag className={shellClass} {...tagProps}>
        <div className={surfaceShellInnerClassName(padding)}>{children}</div>
      </Tag>
    );
  }

  return (
    <Tag className={shellClass} {...tagProps}>
      {children}
    </Tag>
  );
}
