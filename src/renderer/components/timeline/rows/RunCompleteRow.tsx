/**
 * Trailing run closer. Emitted exactly once per completed run by
 * `deriveRows` (see `reducer/deriveRows.ts`) carrying the wall-clock
 * span between the opening `user-prompt` and the final event of the
 * turn.
 *
 * Styled as a thin divider — matching `PhaseDividerRow` — so the
 * timeline gets a quiet end-of-turn marker instead of a card.
 */

interface RunCompleteRowProps {
  durationMs: number;
}

export function RunCompleteRow({ durationMs }: RunCompleteRowProps) {
  return (
    <div className="flex items-center gap-2 py-2">
      <span className="h-px flex-1 bg-border-subtle/45" />
      <span className="text-meta text-text-faint">
        done in {formatDuration(durationMs)}
      </span>
      <span className="h-px flex-1 bg-border-subtle/45" />
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
