/**
 * Thin phase divider. Used by the orchestrator to announce stage
 * transitions (e.g. "Delegating 3 sub-tasks").
 *
 * Sentence-case is preserved as-emitted by the host so the divider reads
 * as a quiet inline tag instead of an all-caps banner. The earlier
 * `uppercase tracking-wider` treatment shouted at the user every time a
 * delegation round started.
 */

interface PhaseDividerRowProps {
  label: string;
}

export function PhaseDividerRow({ label }: PhaseDividerRowProps) {
  return (
    <div className="flex items-center gap-3 py-1">
      <span className="h-px flex-1 bg-border-strong/50" />
      <span className="text-row text-text-faint">{label}</span>
      <span className="h-px flex-1 bg-border-strong/50" />
    </div>
  );
}
