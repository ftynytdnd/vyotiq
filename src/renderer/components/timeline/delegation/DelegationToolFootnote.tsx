/**
 * Mono tool footnote line for Stream weave worker sections.
 */

import { cn } from '../../../lib/cn.js';
import { toolGroupStatus } from '../reducer/deriveRows.js';
import type { DisplayRow } from '../shared/projectSubagentRows.js';
import { footnoteMarker, rowFootnoteLabel } from './delegationHelpers.js';

interface DelegationToolFootnoteProps {
  row: DisplayRow;
  index: number;
  live?: boolean;
}

export function DelegationToolFootnote({ row, index, live = false }: DelegationToolFootnoteProps) {
  const label = rowFootnoteLabel(row);
  if (!label) return null;

  const running =
    live &&
    row.kind === 'tool-group' &&
    toolGroupStatus(row.children) === 'running';

  return (
    <span className="vx-timeline-deleg-weave-footnote-item">
      <sup className="vx-timeline-deleg-weave-fn">{footnoteMarker(index)}</sup>
      <span
        className={cn(
          'vx-timeline-deleg-tool font-mono text-meta text-text-muted',
          running && 'vx-timeline-deleg-tool-live'
        )}
      >
        {label}
      </span>
    </span>
  );
}
