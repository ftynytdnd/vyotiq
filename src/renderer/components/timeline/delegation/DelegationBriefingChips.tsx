/** Briefing chips for the expanded delegation panel. */

import type { SubAgentSnapshot } from '../reducer/types.js';

interface DelegationBriefingChipsProps {
  snap: SubAgentSnapshot;
}

export function DelegationBriefingChips({ snap }: DelegationBriefingChipsProps) {
  const chips: string[] = [];
  for (const f of snap.files ?? []) chips.push(f);
  for (const t of snap.tools ?? []) chips.push(t);
  for (const t of snap.unknownTools ?? []) chips.push(t);

  if (chips.length === 0) return null;

  return (
    <div className="vx-timeline-deleg-chips mb-1 flex flex-wrap gap-1">
      {chips.map((chip) => (
        <span
          key={chip}
          className="rounded-inner border border-border-subtle/30 bg-surface-overlay px-1.5 py-px font-mono text-meta text-text-muted"
        >
          {chip}
        </span>
      ))}
    </div>
  );
}
