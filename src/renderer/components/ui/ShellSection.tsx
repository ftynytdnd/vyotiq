/**
 * ShellSection — React layout primitives wrapping Vyotiq UI (`vx-*`) classes.
 * Shared by Settings, Checkpoints settings, and Context Inspector rules.
 */

import type { ReactNode } from 'react';
import { cn } from '../../lib/cn.js';

export function ShellStack({
  children,
  className
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={cn('vx-stack', className)}>{children}</div>;
}

export function ShellSection({
  title,
  children,
  className,
  variant = 'flat'
}: {
  title: string;
  children: ReactNode;
  className?: string;
  /** `flat` — Linear-lite, no left rail. `rail` — legacy inset rail. */
  variant?: 'flat' | 'rail';
}) {
  return (
    <section className={cn('vx-section', className)}>
      <h3 className="vx-section-head">{title}</h3>
      <div className={cn('vx-section-body', variant === 'rail' && 'vx-section-body--rail')}>
        {children}
      </div>
    </section>
  );
}

export function ShellRow({
  children,
  className
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={cn('vx-row', className)}>{children}</div>;
}

export function ShellRowSplit({
  main,
  control,
  className
}: {
  main: ReactNode;
  control: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('vx-row-split', className)}>
      <div className="vx-row-split-main min-w-0">{main}</div>
      <div className="vx-row-split-control shrink-0">{control}</div>
    </div>
  );
}

export function ShellCaption({
  children,
  className
}: {
  children: ReactNode;
  className?: string;
}) {
  return <p className={cn('vx-caption', className)}>{children}</p>;
}

export function ShellFieldLabel({
  children,
  className,
  htmlFor
}: {
  children: ReactNode;
  className?: string;
  htmlFor?: string;
}) {
  return (
    <label className={cn('vx-field-label', className)} htmlFor={htmlFor}>
      {children}
    </label>
  );
}

export function ShellFieldActions({
  children,
  className,
  grouped
}: {
  children: ReactNode;
  className?: string;
  grouped?: boolean;
}) {
  return (
    <div className={cn('vx-field-actions', grouped && 'vx-field-actions-group', className)}>
      {children}
    </div>
  );
}

export function ShellActionRow({
  children,
  className
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={cn('vx-action-row', className)}>{children}</div>;
}

export function ShellMetaGrid({
  children,
  className
}: {
  children: ReactNode;
  className?: string;
}) {
  return <dl className={cn('vx-meta-grid', className)}>{children}</dl>;
}

export function ShellMetaRow({
  label,
  value,
  mono = false
}: {
  label: string;
  value: ReactNode;
  mono?: boolean;
}) {
  return (
    <>
      <dt className="vx-meta-label">{label}</dt>
      <dd className={cn('vx-meta-value', mono && 'vx-meta-value-mono')}>{value}</dd>
    </>
  );
}
