/**
 * Inline attachment cards for composer + timeline user prompts.
 */

import { useEffect, useMemo, useState } from 'react';
import { File, FileText, X } from 'lucide-react';
import type { PromptAttachmentMeta } from '@shared/types/chat.js';
import { cn } from '../../lib/cn.js';
import {
  SHELL_MICRO_ICON_CLASS,
  SHELL_MICRO_ICON_STROKE,
  SHELL_ROW_ICON_CLASS,
  SHELL_ROW_ICON_STROKE
} from '../../lib/shellIcons.js';
import { useWorkspaceStore } from '../../store/useWorkspaceStore.js';
import { vyotiq } from '../../lib/ipc.js';
import {
  attachmentPreviewPathInput,
  openAttachment
} from '../../lib/openAttachment.js';

function attachmentIcon(mime?: string) {
  if (mime?.startsWith('text/') || mime === 'application/json') return FileText;
  return File;
}

function AttachmentThumbnail({ attachment }: { attachment: PromptAttachmentMeta }) {
  const workspaceId = useWorkspaceStore((s) => s.activeId);
  const [url, setUrl] = useState<string | null>(null);
  const pathInput = useMemo(
    () => attachmentPreviewPathInput(attachment, workspaceId),
    [attachment, workspaceId]
  );

  useEffect(() => {
    if (!pathInput) {
      setUrl(null);
      return;
    }
    let cancelled = false;
    void vyotiq.attachments.fileUrl(pathInput).then((next) => {
      if (!cancelled) setUrl(next);
    });
    return () => {
      cancelled = true;
    };
  }, [pathInput]);

  if (!url) {
    return (
      <span className="vx-attachment-card__thumb vx-attachment-card__thumb--placeholder" aria-hidden />
    );
  }

  return (
    <img
      src={url}
      alt=""
      className="vx-attachment-card__thumb"
      loading="lazy"
      draggable={false}
    />
  );
}

interface PromptAttachmentCardsProps {
  items: PromptAttachmentMeta[];
  /** Composer mode — show remove buttons. */
  editable?: boolean;
  onRemove?: (id: string) => void;
  className?: string;
}

export function PromptAttachmentCards({
  items,
  editable = false,
  onRemove,
  className
}: PromptAttachmentCardsProps) {
  const workspaceId = useWorkspaceStore((s) => s.activeId);

  if (items.length === 0) return null;

  return (
    <div className={cn('flex min-w-0 flex-wrap gap-1.5', className)}>
      {items.map((a) => {
        const Icon = attachmentIcon(a.mimeType);
        const isImage = a.mimeType?.startsWith('image/');
        return (
          <div
            key={a.id}
            className={cn(
              'vx-attachment-card group relative flex max-w-[200px] items-center gap-1.5 rounded-inner border border-border-subtle/40 bg-chrome-hover-soft/40 px-1.5 py-1',
              isImage && 'vx-attachment-card--image'
            )}
          >
            <button
              type="button"
              className={cn(
                'flex min-w-0 flex-1 items-center gap-1.5 text-left',
                isImage && 'justify-center'
              )}
              onClick={() => void openAttachment(a, workspaceId)}
              title={a.name}
            >
              {isImage ? (
                <AttachmentThumbnail attachment={a} />
              ) : (
                <>
                  <Icon className={SHELL_ROW_ICON_CLASS} strokeWidth={SHELL_ROW_ICON_STROKE} />
                  <span className="min-w-0 truncate font-mono text-meta">{a.name}</span>
                </>
              )}
            </button>
            {editable && onRemove && (
              <button
                type="button"
                aria-label={`Remove ${a.name}`}
                onClick={() => onRemove(a.id)}
                className="vx-btn vx-btn-quiet absolute -right-1 -top-1 h-5 w-5 shrink-0 px-0 opacity-0 group-hover:opacity-100"
              >
                <X className={SHELL_MICRO_ICON_CLASS} strokeWidth={SHELL_MICRO_ICON_STROKE} />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
