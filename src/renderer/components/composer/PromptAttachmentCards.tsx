/**
 * Inline attachment cards for composer + timeline user prompts.
 */

import { useEffect, useMemo, useState } from 'react';
import { File, FileText, Film, X } from 'lucide-react';
import type { AttachmentMediaKind, PromptAttachmentMeta } from '@shared/types/chat.js';
import { mediaKindFromMeta } from '@shared/attachments/mediaKind.js';
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

function attachmentMediaKind(meta: PromptAttachmentMeta): AttachmentMediaKind {
  return meta.mediaKind ?? mediaKindFromMeta(meta);
}

function attachmentIcon(kind: AttachmentMediaKind, mime?: string) {
  if (kind === 'video') return Film;
  if (kind === 'text' && (mime?.startsWith('text/') || mime === 'application/json')) return FileText;
  return File;
}

function AttachmentThumbnail({
  attachment,
  compact = false
}: {
  attachment: PromptAttachmentMeta;
  compact?: boolean;
}) {
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
      <span
        className={cn(
          'vx-attachment-card__thumb vx-attachment-card__thumb--placeholder',
          compact && 'vx-attachment-card__thumb--compact'
        )}
        aria-hidden
      />
    );
  }

  return (
    <img
      src={url}
      alt=""
      className={cn('vx-attachment-card__thumb', compact && 'vx-attachment-card__thumb--compact')}
      loading="lazy"
      draggable={false}
    />
  );
}

interface PromptAttachmentCardsProps {
  items: PromptAttachmentMeta[];
  /** Composer mode — show remove buttons. */
  editable?: boolean;
  /** Compact toolbar chips for the composer chip row. */
  variant?: 'card' | 'chip';
  onRemove?: (id: string) => void;
  className?: string;
}

export function PromptAttachmentCards({
  items,
  editable = false,
  variant = 'card',
  onRemove,
  className
}: PromptAttachmentCardsProps) {
  const workspaceId = useWorkspaceStore((s) => s.activeId);
  const compact = variant === 'chip';

  if (items.length === 0) return null;

  if (compact) {
    return (
      <>
        {items.map((a) => {
          const kind = attachmentMediaKind(a);
          const Icon = attachmentIcon(kind, a.mimeType);
          const isImage = kind === 'image';

          return (
            <span
              key={a.id}
              className="vx-attachment-chip group inline-flex h-[1.25rem] min-w-0 items-center gap-0.5 rounded-inner border border-border-subtle/35 bg-chrome-hover-soft/50 pl-1 pr-0.5"
              title={a.name}
            >
              <button
                type="button"
                className="flex min-w-0 flex-1 items-center gap-1 text-left"
                onClick={() => void openAttachment(a, workspaceId)}
              >
                {isImage ? (
                  <AttachmentThumbnail attachment={a} compact />
                ) : (
                  <Icon
                    className={SHELL_MICRO_ICON_CLASS}
                    strokeWidth={SHELL_MICRO_ICON_STROKE}
                  />
                )}
                <span className="min-w-0 truncate font-mono text-meta text-text-secondary">
                  {a.name}
                </span>
              </button>
              {editable && onRemove ? (
                <button
                  type="button"
                  aria-label={`Remove ${a.name}`}
                  onClick={() => onRemove(a.id)}
                  className="vx-btn vx-btn-quiet h-3.5 w-3.5 shrink-0 px-0 text-text-faint opacity-70 group-hover:opacity-100"
                >
                  <X className={SHELL_MICRO_ICON_CLASS} strokeWidth={SHELL_MICRO_ICON_STROKE} />
                </button>
              ) : null}
            </span>
          );
        })}
      </>
    );
  }

  return (
    <div className={cn('flex min-w-0 flex-wrap gap-1.5', className)}>
      {items.map((a) => {
        const kind = attachmentMediaKind(a);
        const Icon = attachmentIcon(kind, a.mimeType);
        const isImage = kind === 'image';

        return (
          <div
            key={a.id}
            className={cn(
              'vx-attachment-card group relative flex max-w-[200px] items-center gap-1.5 rounded-inner border border-border-subtle/40 bg-chrome-hover-soft/40 px-1.5 py-1',
              isImage && 'vx-attachment-card--image',
              isImage && editable && 'vx-attachment-card--image-named'
            )}
          >
            <button
              type="button"
              className={cn(
                'flex min-w-0 flex-1 items-center gap-1.5 text-left',
                isImage && !editable && 'justify-center'
              )}
              onClick={() => void openAttachment(a, workspaceId)}
              title={a.name}
            >
              {isImage ? (
                <>
                  <AttachmentThumbnail attachment={a} />
                  {editable ? (
                    <span className="min-w-0 truncate font-mono text-meta text-text-faint">
                      {a.name}
                    </span>
                  ) : null}
                </>
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
