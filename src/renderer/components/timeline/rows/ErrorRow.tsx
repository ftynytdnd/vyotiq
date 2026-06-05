/**
 * Top-level error row — terminal run failures (provider errors, etc.).
 */

import { AlertCircle } from 'lucide-react';
import { timelineLogRowClassName } from '../shared/rowStyles.js';
import { cn } from '../../../lib/cn.js';
import { SHELL_ROW_ICON_CLASS, SHELL_ROW_ICON_STROKE } from '../../../lib/shellIcons.js';
import { Button } from '../../ui/Button.js';

interface ErrorRowProps {
  message: string;
  onRetry?: () => void;
  onOpenProviders?: () => void;
  showProviders?: boolean;
}

export function ErrorRow({
  message,
  onRetry,
  onOpenProviders,
  showProviders = false
}: ErrorRowProps) {
  return (
    <div
      className={cn(
        'vyotiq-stepfade-once vx-timeline-error-row',
        timelineLogRowClassName,
        'flex-col gap-2'
      )}
      data-row-kind="error"
      role="alert"
    >
      <div className="flex items-start gap-2">
        <AlertCircle
          className={cn(SHELL_ROW_ICON_CLASS, 'mt-0.5 shrink-0 text-danger')}
          strokeWidth={SHELL_ROW_ICON_STROKE}
          aria-hidden
        />
        <div className="min-w-0 flex-1 whitespace-pre-wrap text-row text-danger">{message}</div>
      </div>
      {(onRetry || (showProviders && onOpenProviders)) && (
        <div className="flex flex-wrap items-center gap-2 pl-6">
          {onRetry ? (
            <Button type="button" size="sm" variant="secondary" onClick={onRetry}>
              Retry last message
            </Button>
          ) : null}
          {showProviders && onOpenProviders ? (
            <Button type="button" size="sm" variant="link" onClick={onOpenProviders}>
              Open providers
            </Button>
          ) : null}
        </div>
      )}
    </div>
  );
}
