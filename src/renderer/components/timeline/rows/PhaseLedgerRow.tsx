/**
 * Collapsible phased-execution ledger artifact row.
 */

import { useState } from 'react';

interface PhaseLedgerRowProps {
  subtaskId: string;
  phase: string;
  summary: string;
  collapsedDefault?: boolean;
}

export function PhaseLedgerRow({
  subtaskId,
  phase,
  summary,
  collapsedDefault = true
}: PhaseLedgerRowProps) {
  const [open, setOpen] = useState(!collapsedDefault);
  return (
    <div className="vyotiq-stepfade-once py-0.5 text-meta" data-row-kind="phase-ledger">
      <button
        type="button"
        className="flex w-full items-center gap-2 text-left vx-caption text-text-faint hover:text-text-muted"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="shrink-0 uppercase tracking-wide">{phase}</span>
        <span className="truncate">{subtaskId.slice(0, 8)}…</span>
      </button>
      {open ? (
        <pre className="ml-2 mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words border-l border-border-subtle pl-3 font-mono text-[11px] text-text-faint">
          {summary}
        </pre>
      ) : null}
    </div>
  );
}
