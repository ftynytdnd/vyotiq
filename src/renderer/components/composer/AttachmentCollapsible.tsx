import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import type { PromptAttachmentMeta } from '@shared/types/chat.js';
import { PromptAttachmentCards } from './PromptAttachmentCards.js';
import { cn } from '../../lib/cn.js';
import { SHELL_ROW_ICON_CLASS, SHELL_ROW_ICON_STROKE } from '../../lib/shellIcons.js';

interface AttachmentCollapsibleProps {
  items: PromptAttachmentMeta[];
  editable?: boolean;
  onRemove?: (id: string) => void;
  className?: string;
}

export function AttachmentCollapsible({
  items,
  editable,
  onRemove,
  className
}: AttachmentCollapsibleProps) {
  const [expanded, setExpanded] = useState(true);
  if (items.length === 0) return null;

  return (
    <div className={cn('mb-1', className)}>
      <button
        type="button"
        className="vx-btn vx-btn-quiet mb-0.5 flex w-full items-center gap-1 px-1 py-0.5 text-meta text-text-secondary"
        aria-expanded={expanded}
        onClick={() => setExpanded((v) => !v)}
      >
        <ChevronDown
          className={cn(
            SHELL_ROW_ICON_CLASS,
            'transition-transform',
            !expanded && '-rotate-90'
          )}
          strokeWidth={SHELL_ROW_ICON_STROKE}
        />
        <span>
          {items.length} attachment{items.length === 1 ? '' : 's'}
        </span>
      </button>
      {expanded ? (
        <PromptAttachmentCards items={items} editable={editable} onRemove={onRemove} />
      ) : null}
    </div>
  );
}
