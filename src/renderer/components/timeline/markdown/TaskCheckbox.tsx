/**
 * GFM task-list checkbox icon — shared by settled (`MarkdownBody`) and
 * streaming (`StreamingMarkdownBody`) render paths.
 */

import { Check } from 'lucide-react';
import { cn } from '../../../lib/cn.js';

export function TaskCheckbox({ checked }: { checked: boolean }) {
  return (
    <span
      role="img"
      aria-label={checked ? 'Completed' : 'Not completed'}
      className={cn(
        'mr-1.5 inline-flex h-3.5 w-3.5 shrink-0 -translate-y-px items-center justify-center rounded-[3px] border align-text-bottom',
        checked
          ? 'border-success/60 bg-success/15 text-success'
          : 'border-border-subtle/35 bg-surface-overlay/20 text-transparent'
      )}
    >
      <Check className="h-2.5 w-2.5" strokeWidth={3} aria-hidden />
    </span>
  );
}
