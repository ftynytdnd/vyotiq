/**
 * Top-level error row — terminal run failures (provider errors, etc.).
 */

import { AlertCircle } from 'lucide-react';
import { formatTokenCountWithUnit } from '../../../lib/formatTokens.js';
import type { TokenUsageAggregate } from '../reducer/types.js';
import { timelineLogRowClassName, timelineRunCompleteRowClassName } from '../shared/rowStyles.js';
import { cn } from '../../../lib/cn.js';
import { SHELL_ROW_ICON_CLASS, SHELL_ROW_ICON_STROKE } from '../../../lib/shellIcons.js';
import { Button } from '../../ui/Button.js';
import { formatDuration } from './RunCompleteRow.js';

interface ErrorRowProps {
  message: string;
  durationMs?: number;
  completedAt?: number;
  usage?: TokenUsageAggregate;
  editCount?: number;
  fileCount?: number;
  onRetry?: () => void;
  onOpenProviders?: () => void;
  showProviders?: boolean;
}

function ErrorRunMeta({
  durationMs,
  completedAt,
  usage,
  editCount,
  fileCount
}: Pick<ErrorRowProps, 'durationMs' | 'completedAt' | 'usage' | 'editCount' | 'fileCount'>) {
  if (durationMs === undefined || completedAt === undefined) return null;

  const tokenLabel =
    usage && usage.cumulative.totalTokens > 0
      ? formatTokenCountWithUnit(usage.cumulative.totalTokens)
      : null;

  const stats: string[] = [];
  if (typeof editCount === 'number' && editCount > 0) {
    stats.push(`${editCount} edit${editCount === 1 ? '' : 's'}`);
  }
  if (typeof fileCount === 'number' && fileCount > 0) {
    stats.push(`${fileCount} file${fileCount === 1 ? '' : 's'}`);
  }

  const timeLabel = new Date(completedAt).toLocaleString(undefined, {
    hour: 'numeric',
    minute: '2-digit'
  });

  return (
    <div
      className={cn(
        'vx-timeline-meta text-text-faint pl-6',
        timelineRunCompleteRowClassName
      )}
      aria-label={[
        stats.length > 0 ? stats.join(' · ') : null,
        `done in ${formatDuration(durationMs)}`,
        tokenLabel,
        timeLabel
      ]
        .filter(Boolean)
        .join(' · ')}
    >
      {stats.length > 0 ? (
        <>
          <span>{stats.join(' · ')}</span>
          <span aria-hidden className="text-text-faint/70">
            {' · '}
          </span>
        </>
      ) : null}
      <span>done in {formatDuration(durationMs)}</span>
      {tokenLabel !== null ? (
        <>
          <span aria-hidden className="text-text-faint/70">
            {' · '}
          </span>
          <span className="font-mono tabular-nums">{tokenLabel}</span>
        </>
      ) : null}
      <span aria-hidden className="text-text-faint/70">
        {' · '}
      </span>
      <time dateTime={new Date(completedAt).toISOString()} className="tabular-nums">
        {timeLabel}
      </time>
    </div>
  );
}

export function ErrorRow({
  message,
  durationMs,
  completedAt,
  usage,
  editCount,
  fileCount,
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
      <ErrorRunMeta
        durationMs={durationMs}
        completedAt={completedAt}
        usage={usage}
        editCount={editCount}
        fileCount={fileCount}
      />
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
