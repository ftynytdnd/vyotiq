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
import type { DiffLinePick } from './diffLinePick.js';
import { pickAnchorLine } from './diffLinePick.js';

interface DiffLineProps {
  line: DiffLineModel;
  oldNo: number | null;
  newNo: number | null;
  intra?: IntraLineHighlight;
  /** Reserved for partial-stream tip styling (cursor removed in redesign). */
  isStreamingTip?: boolean;
  /** Review mode: click a line to anchor a comment. */
  linePick?: {
    highlightLine: number | null;
    onPick: (pick: DiffLinePick) => void;
  };
}

export function DiffLine({
  line,
  oldNo,
  newNo,
  intra,
  isStreamingTip: _isStreamingTip = false,
  linePick
}: DiffLineProps) {
  const anchor = pickAnchorLine({ newLine: newNo, oldLine: oldNo });
  const highlighted =
    linePick &&
    anchor !== null &&
    linePick.highlightLine !== null &&
    anchor === linePick.highlightLine;

  const pickable = linePick && anchor !== null;

  return (
    <div
      role={pickable ? 'button' : undefined}
      tabIndex={pickable ? 0 : undefined}
      onClick={
        pickable
          ? () => {
            linePick.onPick({ newLine: newNo, oldLine: oldNo });
          }
          : undefined
      }
      onKeyDown={
        pickable
          ? (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              linePick.onPick({ newLine: newNo, oldLine: oldNo });
            }
          }
          : undefined
      }
      className={cn(
        'flex items-stretch px-1',
        line.kind === '+' && (intra ? 'bg-success-faint text-success' : 'bg-success-soft text-success'),
        line.kind === '-' && (intra ? 'bg-danger-faint text-danger' : 'bg-danger-soft text-danger'),
        line.kind === ' ' && 'text-text-secondary',
        pickable && 'vx-diff-line-pickable',
        highlighted && 'vx-diff-line-highlighted'
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
              line.kind === '+' ? 'bg-success-emphasis' : 'bg-danger-emphasis'
            )}>
              {intra.changed}
            </span>
            {intra.suffix}
          </>
        ) : (
          line.text
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
