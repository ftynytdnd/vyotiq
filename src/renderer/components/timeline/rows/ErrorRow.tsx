/**
 * Top-level error row — terminal run failures (provider errors, etc.).
 */

import { AlertCircle } from 'lucide-react';
import { timelineLogRowClassName } from '../shared/rowStyles.js';
import { cn } from '../../../lib/cn.js';
import { SHELL_ROW_ICON_CLASS, SHELL_ROW_ICON_STROKE } from '../../../lib/shellIcons.js';

interface ErrorRowProps {
  message: string;
}

export function ErrorRow({ message }: ErrorRowProps) {
  return (
    <div
      className={cn(
        'vyotiq-stepfade-once vx-timeline-error-row',
        timelineLogRowClassName
      )}
      data-row-kind="error"
      role="alert"
    >
      <AlertCircle
        className={cn(SHELL_ROW_ICON_CLASS, 'mt-0.5 shrink-0 text-danger')}
        strokeWidth={SHELL_ROW_ICON_STROKE}
        aria-hidden
      />
      <div className="min-w-0 flex-1 whitespace-pre-wrap text-row text-danger">{message}</div>
    </div>
  );
}
