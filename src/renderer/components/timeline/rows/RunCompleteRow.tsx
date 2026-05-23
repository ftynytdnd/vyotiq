/**
 * Trailing run closer — quiet label without horizontal rules so the
 * timeline doesn't sprawl a hairline into the footer gap.
 */

import { formatTokenCount } from '../../../lib/formatTokens.js';
import type { TokenUsageAggregate } from '../reducer/types.js';

interface RunCompleteRowProps {
  durationMs: number;
  usage?: TokenUsageAggregate;
}

export function RunCompleteRow({ durationMs, usage }: RunCompleteRowProps) {
  const tokenLabel =
    usage && usage.cumulative.totalTokens > 0
      ? formatTokenCount(usage.cumulative.totalTokens)
      : null;

  return (
    <div
      className="py-0.5 text-center text-meta text-text-faint"
      aria-label={`Run completed in ${formatDuration(durationMs)}${tokenLabel ? `, ${tokenLabel} tokens` : ''}`}
    >
      done in {formatDuration(durationMs)}
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

function formatDuration(ms: number): string {
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
