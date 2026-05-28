/**
 * Trailing run closer — quiet flush log line (no horizontal rules).
 */

import { formatTokenCountWithUnit } from '../../../lib/formatTokens.js';
import type { TokenUsageAggregate } from '../reducer/types.js';
import { cn } from '../../../lib/cn.js';
import { timelineLogRowClassName } from '../shared/rowStyles.js';

interface RunCompleteRowProps {
  durationMs: number;
  completedAt: number;
  usage?: TokenUsageAggregate;
  editCount?: number;
  fileCount?: number;
}

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
  const ariaParts = [...stats, `completed in ${durationLabel}`, timeLabel];
  if (tokenLabel) ariaParts.push(tokenLabel);

  return (
    <div
      className={cn('vyotiq-stepfade-once vx-timeline-meta text-text-secondary', timelineLogRowClassName)}
      data-row-kind="run-complete"
      aria-label={ariaParts.join(', ')}
    >
      {stats.length > 0 && (
        <>
          {stats.join(' · ')}
          <span aria-hidden className="mx-1.5 text-text-faint/70">
            ·
          </span>
        </>
      )}
      done in {durationLabel}
      {tokenLabel !== null && (
        <>
          <span aria-hidden className="mx-1.5 text-text-faint/70">
            ·
          </span>
          <span className="font-mono tabular-nums">{tokenLabel}</span>
        </>
      )}
      <span aria-hidden className="mx-1.5 text-text-faint/70">
        ·
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

function formatWallClock(ts: number): string {
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
