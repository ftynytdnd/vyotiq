/**
 * Single-row renderer for a `DiffLine` inside a hunk. Owns the
 * `+` / `-` / ` ` colour stain, optional intra-line word-diff
 * highlight, line-number gutter cells, and the trailing streaming
 * cursor when this row is the partial-stream tip.
 *
 * Pure presentation — no state, no effects. The parent (`DiffHunk`)
 * owns the gutter math (`oldStart`, `newStart`) and the
 * intra-line map; this component receives a fully resolved
 * `oldNo` / `newNo` for the gutter and a pre-computed
 * `IntraLineHighlight` slot when the line participates in a
 * word-diff pair.
 */

import type { DiffLine as DiffLineModel } from '@shared/types/tool.js';
import { cn } from '../../../../../lib/cn.js';
import type { IntraLineHighlight } from './useIntraLineHighlight.js';

interface DiffLineProps {
  line: DiffLineModel;
  oldNo: number | null;
  newNo: number | null;
  intra?: IntraLineHighlight;
  isStreamingTip?: boolean;
}

export function DiffLine({
  line,
  oldNo,
  newNo,
  intra,
  isStreamingTip
}: DiffLineProps) {
  return (
    <div
      className={cn(
        'flex items-stretch px-1',
        line.kind === '+' && (intra ? 'bg-success/[0.05] text-success' : 'bg-success/10 text-success'),
        line.kind === '-' && (intra ? 'bg-danger/[0.05] text-danger' : 'bg-danger/10 text-danger'),
        line.kind === ' ' && 'text-text-secondary'
      )}
    >
      <GutterCell n={oldNo} />
      <GutterCell n={newNo} />
      <span className="mr-1 select-none text-text-faint">{line.kind}</span>
      <span className="min-w-0 flex-1 whitespace-pre-wrap">
        {intra ? (
          <>
            {intra.prefix}
            <span className={cn(
              'rounded-[2px] px-px',
              line.kind === '+' ? 'bg-success/25' : 'bg-danger/25'
            )}>
              {intra.changed}
            </span>
            {intra.suffix}
          </>
        ) : (
          line.text
        )}
        {isStreamingTip && (
          <span
            aria-hidden="true"
            className="vyotiq-stream-cursor ml-px inline-block h-[1em] w-[0.55ch] align-text-bottom"
          />
        )}
      </span>
    </div>
  );
}

function GutterCell({ n }: { n: number | null }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'mr-1 inline-block w-9 shrink-0 select-none text-right font-mono text-meta',
        'text-text-faint/70 tabular-nums'
      )}
    >
      {n ?? ''}
    </span>
  );
}
