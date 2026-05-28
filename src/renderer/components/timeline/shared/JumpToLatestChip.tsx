/**
 * JumpToLatestChip — compact floating pill when the user scrolls away
 * from the tail during an in-flight run.
 */

import { ArrowDown, ArrowUpToLine } from 'lucide-react';
import { chromePopoverPanelClassName } from '../../ui/SurfaceShell.js';
import { cn } from '../../../lib/cn.js';
import { timelineActionPillClassName } from './rowStyles.js';

interface JumpToLatestChipProps {
  onClick: () => void;
  onJumpToTop?: () => void;
}

const pillClass = cn(
  timelineActionPillClassName,
  chromePopoverPanelClassName,
  'pointer-events-auto text-text-secondary',
  'border border-border-subtle/40 bg-surface-raised shadow-md',
  'transition-[color,background-color,border-color] duration-150 ease-out',
  'hover:border-border-subtle/60 hover:text-text-primary'
);

export function JumpToLatestChip({ onClick, onJumpToTop }: JumpToLatestChipProps) {
  return (
    <div
      role="group"
      aria-label="Scroll shortcuts"
      className="group/latest flex items-stretch justify-end overflow-hidden rounded-inner"
    >
      <button type="button" onClick={onClick} className={cn(pillClass, 'px-2.5 py-1')}>
        <ArrowDown className="h-3 w-3" strokeWidth={2.25} />
        <span>Latest</span>
      </button>
      {onJumpToTop && (
        <button
          type="button"
          onClick={onJumpToTop}
          aria-label="Scroll to top"
          title="Scroll to top"
          className={cn(
            pillClass,
            'border-l-0 px-2 py-1 text-meta text-text-faint',
            'max-w-0 overflow-hidden opacity-0 transition-all duration-150',
            'group-hover/latest:max-w-[4.5rem] group-hover/latest:border-l group-hover/latest:border-border-subtle/40 group-hover/latest:opacity-100'
          )}
        >
          <ArrowUpToLine className="h-2.5 w-2.5 shrink-0" strokeWidth={2.25} />
          <span className="whitespace-nowrap">Top</span>
        </button>
      )}
    </div>
  );
}
