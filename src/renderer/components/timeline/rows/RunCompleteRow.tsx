/**
 * Trailing run closer — quiet flush log line (no horizontal rules).
 */

import { formatTokenCountWithUnit } from '../../../lib/formatTokens.js';
import type { TokenUsageAggregate } from '../reducer/types.js';
import { cn } from '../../../lib/cn.js';
import { timelineRunCompleteRowClassName } from '../shared/rowStyles.js';

interface RunCompleteRowProps {
  durationMs: number;
  completedAt: number;
  usage?: TokenUsageAggregate;
  editCount?: number;
  fileCount?: number;
}

/** Turns at or above this duration get a warning tone on the elapsed label. */
const LONG_TURN_WARN_MS = 120_000;

/** Turns at or above this duration get a stronger warning + tooltip. */
const VERY_LONG_TURN_WARN_MS = 480_000;

export function RunCompleteRow({
  durationMs,
  completedAt,
  usage,
  editCount,
  fileCount
}: RunCompleteRowProps) {
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

  const durationLabel = formatDuration(durationMs);
  const timeLabel = formatWallClock(completedAt);
  const tokenTitle = tokenLabel ? `${tokenLabel} used this turn` : null;
  const veryLongTurn = durationMs >= VERY_LONG_TURN_WARN_MS;
  const longTurn = durationMs >= LONG_TURN_WARN_MS;
  const durationTitle = veryLongTurn
    ? 'This turn took unusually long — often approval waits or connection delays.'
    : longTurn
      ? 'This turn took longer than usual.'
      : undefined;
  const metaParts: string[] = [`done in ${durationLabel}`];
  if (tokenLabel) metaParts.push(tokenLabel);
  metaParts.push(timeLabel);
  if (stats.length > 0) metaParts.unshift(stats.join(' · '));
  const ariaLabel = metaParts.join(' · ');

  return (
    <div
      className={cn(
        'vyotiq-stepfade-once vx-timeline-meta text-text-secondary',
        timelineRunCompleteRowClassName
      )}
      data-row-kind="run-complete"
      aria-label={ariaLabel}
    >
      {stats.length > 0 ? (
        <>
          <span>{stats.join(' · ')}</span>
          <span aria-hidden className="text-text-faint/70">
            {' · '}
          </span>
        </>
      ) : null}
      <span>
        done in{' '}
        <span
          className={cn(
            veryLongTurn && 'text-warning',
            !veryLongTurn && longTurn && 'text-text-faint'
          )}
          title={durationTitle}
        >
          {durationLabel}
        </span>
      </span>
      {tokenLabel !== null ? (
        <>
          <span aria-hidden className="text-text-faint/70">
            {' · '}
          </span>
          <span className="font-mono tabular-nums" title={tokenTitle ?? undefined}>
            {tokenLabel}
          </span>
        </>
      ) : null}
      <span aria-hidden className="text-text-faint/70">
        {' · '}
      </span>
      <time dateTime={new Date(completedAt).toISOString()} className="tabular-nums text-text-faint">
        {timeLabel}
      </time>
    </div>
  );
}

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0s';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const totalSeconds = ms / 1000;
  if (totalSeconds < 60) {
    return `${totalSeconds.toFixed(totalSeconds < 10 ? 1 : 0)}s`;
  }
  const totalMinutes = Math.floor(totalSeconds / 60);
  const seconds = Math.round(totalSeconds - totalMinutes * 60);
  if (totalMinutes < 60) {
    return seconds > 0 ? `${totalMinutes}m ${seconds}s` : `${totalMinutes}m`;
  }
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes - hours * 60;
  return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
}

export function formatWallClock(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  return d.toLocaleString(undefined, {
    ...(sameDay ? {} : { month: 'short', day: 'numeric' }),
    hour: 'numeric',
    minute: '2-digit'
  });
}
