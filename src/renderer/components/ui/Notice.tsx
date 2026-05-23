/**
 * Notice — inline callout for status messages (info / success / warning
 * / danger). Replaces the ad-hoc opacity-literal callouts that had
 * drifted across the renderer:
 *
 *   - `PermissionsTab` web-search endpoint warning
 *   - `ProvidersPanel` provider-load error
 *   - `ContextInspectorPanel` inspector error
 *   - `AddProviderForm` validation message
 *   - Timeline `ErrorRow` (denser variant for log-line rhythm)
 *
 * Surface design follows the stealth-dark language: hairline left
 * rail in the tone's `*-strong` color (1px @ 0.5 alpha through
 * `border-{tone}/50` so the rail reads as a quiet marker, not a
 * blocky banner) + a soft tonal background wash via the
 * `bg-{tone}-soft` tokens introduced in `index.css`'s `@theme`
 * block. The icon comes from lucide-react and reuses the same
 * 14×14 sizing convention as the rest of the icon family.
 *
 * Variants:
 *   - `tone`:
 *       'info'    — accent-tinted, used for neutral hints.
 *       'success' — green wash + leaf icon, used for positive feedback.
 *       'warning' — amber wash + triangle icon, used for soft warnings.
 *       'danger'  — red wash + circle-alert icon, used for failures.
 *   - `size`:
 *       'md' (default) — padded `px-3 py-2`, fits modal panels and
 *                        Settings rows.
 *       'sm'           — denser `px-2 py-1` for timeline log-lines
 *                        where vertical space is at a premium
 *                        (replaces the bespoke `ErrorRow` chrome).
 *
 * `title` renders bold above the body when supplied; otherwise the
 * body sits flush with the icon. `actions` is a slot for a trailing
 * button cluster (e.g. ProvidersPanel's "Retry" button). `role` is
 * derived from tone:
 *   - danger / warning → `role="alert"` + `aria-live="assertive"`
 *   - info / success   → `role="status"` + `aria-live="polite"`
 *
 * Callers retain full control of when the notice mounts; this
 * primitive is purely presentational.
 */

import React from 'react';
import { AlertCircle, AlertTriangle, CheckCircle2, Info, type LucideIcon } from 'lucide-react';
import { cn } from '../../lib/cn.js';

type NoticeTone = 'info' | 'success' | 'warning' | 'danger';
type NoticeSize = 'sm' | 'md';

interface ToneShape {
  rail: string;
  wash: string;
  text: string;
  iconClass: string;
  Icon: LucideIcon;
}

const TONE: Record<NoticeTone, ToneShape> = {
  info: {
    rail: 'border-accent/50',
    wash: 'bg-accent-soft',
    text: 'text-text-secondary',
    iconClass: 'text-accent',
    Icon: Info
  },
  success: {
    rail: 'border-success/50',
    wash: 'bg-success-soft',
    text: 'text-text-secondary',
    iconClass: 'text-success',
    Icon: CheckCircle2
  },
  warning: {
    rail: 'border-warning/50',
    wash: 'bg-warning-soft',
    text: 'text-warning',
    iconClass: 'text-warning',
    Icon: AlertTriangle
  },
  danger: {
    rail: 'border-danger/50',
    wash: 'bg-danger-soft',
    text: 'text-danger',
    iconClass: 'text-danger',
    Icon: AlertCircle
  }
};

interface SizeShape {
  /** Body container padding. */
  padding: string;
  /** Icon dimension utility (`h-* w-*`). */
  iconBox: string;
  /** Body text size token. */
  body: string;
  /** Gap between icon and body. */
  gap: string;
}

const SIZE: Record<NoticeSize, SizeShape> = {
  sm: {
    padding: 'px-2 py-1',
    iconBox: 'h-3 w-3',
    body: 'text-row',
    gap: 'gap-1.5'
  },
  md: {
    padding: 'px-3 py-2',
    iconBox: 'h-3.5 w-3.5',
    body: 'text-row leading-relaxed',
    gap: 'gap-2.5'
  }
};

interface NoticeProps {
  tone?: NoticeTone;
  size?: NoticeSize;
  /** Bold headline rendered above the body. Optional. */
  title?: React.ReactNode;
  /** Optional explicit icon override. When omitted, the tone's
   *  default icon is used. Pass `null` to suppress the icon entirely
   *  for a left-rail-only treatment. */
  icon?: LucideIcon | null;
  /** Trailing actions slot (e.g. a single "Retry" button). Rendered
   *  flush-right inside the same row as the body when supplied. */
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  /** Forwarded to the outer `<div>` so callers can attach `id` or
   *  `data-*` attributes. */
  id?: string;
}

export function Notice({
  tone = 'info',
  size = 'md',
  title,
  icon,
  actions,
  children,
  className,
  id
}: NoticeProps) {
  const shape = TONE[tone];
  const sizing = SIZE[size];
  const ResolvedIcon = icon === null ? null : icon ?? shape.Icon;
  // Assertive announcement for failure states so screen readers
  // interrupt the user — polite for neutral / success states so
  // the reader finishes its current sentence first.
  const role = tone === 'danger' || tone === 'warning' ? 'alert' : 'status';
  const ariaLive = tone === 'danger' || tone === 'warning' ? 'assertive' : 'polite';
  return (
    <div
      {...(id ? { id } : {})}
      role={role}
      aria-live={ariaLive}
      className={cn(
        'flex items-start rounded-inner border-l-2',
        sizing.padding,
        sizing.gap,
        shape.rail,
        shape.wash,
        className
      )}
    >
      {ResolvedIcon !== null && (
        <ResolvedIcon
          className={cn('mt-0.5 shrink-0', sizing.iconBox, shape.iconClass)}
          strokeWidth={2.25}
        />
      )}
      <div className={cn('min-w-0 flex-1', sizing.body, shape.text)}>
        {title !== undefined && (
          <div className={cn('font-medium', shape.text)}>{title}</div>
        )}
        <div className={title !== undefined ? 'mt-0.5' : undefined}>{children}</div>
      </div>
      {actions !== undefined && <div className="ml-2 shrink-0">{actions}</div>}
    </div>
  );
}
