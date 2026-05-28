/**
 * Trailing run closer — quiet flush log line (no horizontal rules).
 */

import { formatTokenCount } from '../../../lib/formatTokens.js';
import type { TokenUsageAggregate } from '../reducer/types.js';
import { cn } from '../../../lib/cn.js';
import { timelineLogRowClassName } from '../shared/rowStyles.js';

interface RunCompleteRowProps {
  durationMs: number;
  usage?: TokenUsageAggregate;
  editCount?: number;
  fileCount?: number;
}

export function RunCompleteRow({
  durationMs,
  usage,
  editCount,
  fileCount
}: RunCompleteRowProps) {
  const tokenLabel =
    usage && usage.cumulative.totalTokens > 0
      ? formatTokenCount(usage.cumulative.totalTokens)
      : null;

  const stats: string[] = [];
  if (typeof editCount === 'number' && editCount > 0) {
    stats.push(`${editCount} edit${editCount === 1 ? '' : 's'}`);
  }
  if (typeof fileCount === 'number' && fileCount > 0) {
    stats.push(`${fileCount} file${fileCount === 1 ? '' : 's'}`);
  }

  const durationLabel = formatDuration(durationMs);
  const ariaParts = [...stats, `completed in ${durationLabel}`];
  if (tokenLabel) ariaParts.push(`${tokenLabel} tokens`);

  return (
    <div
      className={cn(
        'vyotiq-stepfade-once py-1 text-center text-meta text-text-faint',
        timelineLogRowClassName
      )}
      data-row-kind="run-complete"
      aria-label={ariaParts.join(', ')}
    >
      {stats.length > 0 && (
        <>
          {stats.join(' · ')}
          <span aria-hidden className="mx-1.5 text-text-faint/50">
            ·
          </span>
        </>
      )}
      done in {durationLabel}
      {tokenLabel !== null && (
        <>
          <span aria-hidden className="mx-1.5 text-text-faint/50">
            ·
          </span>
          <span className="font-mono">{tokenLabel} tok</span>
        </>
      )}
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
