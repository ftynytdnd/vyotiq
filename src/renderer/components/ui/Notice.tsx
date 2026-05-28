/**
 * Notice — Vyotiq UI inline callout (`vx-notice`).
 */

import React from 'react';
import { AlertCircle, AlertTriangle, CheckCircle2, Info, type LucideIcon } from 'lucide-react';
import { cn } from '../../lib/cn.js';
import { SHELL_ROW_ICON_CLASS, SHELL_ROW_ICON_STROKE } from '../../lib/shellIcons.js';

type NoticeTone = 'info' | 'success' | 'warning' | 'danger';
type NoticeSize = 'sm' | 'md';

const TONE_ICON: Record<NoticeTone, LucideIcon> = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  danger: AlertCircle
};

interface NoticeProps {
  tone?: NoticeTone;
  size?: NoticeSize;
  title?: React.ReactNode;
  icon?: LucideIcon | null;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
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
  const ResolvedIcon = icon === null ? null : icon ?? TONE_ICON[tone];
  const role = tone === 'danger' || tone === 'warning' ? 'alert' : 'status';
  const ariaLive = tone === 'danger' || tone === 'warning' ? 'assertive' : 'polite';

  return (
    <div
      {...(id ? { id } : {})}
      role={role}
      aria-live={ariaLive}
      className={cn('vx-notice', size === 'sm' && 'text-meta', className)}
    >
      {ResolvedIcon !== null && (
        <ResolvedIcon
          className={cn(SHELL_ROW_ICON_CLASS, 'opacity-45')}
          strokeWidth={SHELL_ROW_ICON_STROKE}
          aria-hidden
        />
      )}
      <div className="min-w-0 flex-1">
        {title !== undefined && <div className="vx-row-label font-medium">{title}</div>}
        <div>{children}</div>
      </div>
      {actions !== undefined && <div className="vx-notice-action shrink-0">{actions}</div>}
    </div>
  );
}
