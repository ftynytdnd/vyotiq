import { X } from 'lucide-react';
import type { PromptAttachmentMeta } from '@shared/types/chat.js';
import { cn } from '../../lib/cn.js';
import {
  SHELL_MICRO_ICON_CLASS,
  SHELL_MICRO_ICON_STROKE
} from '../../lib/shellIcons.js';

interface AttachmentChipRowProps {
  items: PromptAttachmentMeta[];
  onRemove?: (id: string) => void;
  className?: string;
}

/** Compact attachment chips for the composer toolbar row. */
export function AttachmentChipRow({ items, onRemove, className }: AttachmentChipRowProps) {
  if (items.length === 0) return null;

  return (
    <>
      {items.map((item) => (
        <span
          key={item.id}
          className={cn(
            'vx-composer-attach-chip inline-flex max-w-[9rem] min-w-0 items-center gap-0.5',
            className
          )}
          title={item.name}
        >
          <span className="min-w-0 truncate font-mono text-meta text-text-secondary">
            {item.name}
          </span>
          {onRemove ? (
            <button
              type="button"
              aria-label={`Remove ${item.name}`}
              onClick={() => onRemove(item.id)}
              className="vx-btn vx-btn-quiet h-4 w-4 shrink-0 px-0 text-text-faint"
            >
              <X className={SHELL_MICRO_ICON_CLASS} strokeWidth={SHELL_MICRO_ICON_STROKE} />
            </button>
          ) : null}
        </span>
      ))}
    </>
  );
}
