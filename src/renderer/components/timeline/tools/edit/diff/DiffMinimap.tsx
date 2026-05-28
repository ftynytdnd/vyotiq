/**
 * Narrow hunk-position gutter for quick jumps inside large diffs.
 */

import type { DiffHunk } from '@shared/types/tool.js';
import { cn } from '../../../../../lib/cn.js';

interface DiffMinimapProps {
  hunks: readonly DiffHunk[];
  activeIdx: number;
  onJump: (idx: number) => void;
}

export function DiffMinimap({ hunks, activeIdx, onJump }: DiffMinimapProps) {
  if (hunks.length < 2) return null;

  return (
    <div
      className="sticky top-8 z-10 ml-1 flex w-1.5 shrink-0 flex-col gap-0.5 self-stretch py-1"
      aria-label="Diff hunk minimap"
    >
      {hunks.map((hunk, idx) => {
        const changed = hunk.lines.some((l) => l.kind === '+' || l.kind === '-');
        return (
          <button
            key={idx}
            type="button"
            title={`Jump to hunk ${idx + 1}`}
            aria-label={`Jump to hunk ${idx + 1}`}
            aria-current={idx === activeIdx ? 'true' : undefined}
            onClick={() => onJump(idx)}
            className={cn(
              'min-h-[3px] flex-1 rounded-full transition-colors duration-150',
              changed ? 'bg-accent/35 hover:bg-accent/55' : 'bg-border-subtle/25 hover:bg-border-subtle/45',
              idx === activeIdx && 'ring-1 ring-accent/60'
            )}
          />
        );
      })}
    </div>
  );
}
