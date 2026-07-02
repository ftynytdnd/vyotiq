/**
 * Attachment preview body for the workbench Preview tab.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { LoadingHint } from '../ui/LoadingHint.js';
import { vyotiq } from '../../lib/ipc.js';
import type { PromptAttachmentMeta } from '@shared/types/chat.js';
import { useWorkspaceStore } from '../../store/useWorkspaceStore.js';
import {
  attachmentPreviewKind,
  attachmentPreviewUsesFileUrl,
  isTextPreviewAttachment
} from '../../lib/attachmentPreview.js';
import {
  attachmentPreviewPathInput,
  canPreviewAttachmentInApp,
  openAttachmentExternal
} from '../../lib/openAttachment.js';
import { useAttachmentPreviewStore } from '../../store/useAttachmentPreviewStore.js';
import { registerPreviewDomFocus } from '../../lib/workbenchFocusDom.js';
import { cn } from '../../lib/cn.js';
import { WORKBENCH_BODY_CLASS } from './workbenchShared.js';

export interface PreviewZoneProps {
  attachment: PromptAttachmentMeta;
}

type LoadPhase = 'idle' | 'loading' | 'done';

export function PreviewZone({ attachment }: PreviewZoneProps) {
  const workspaceId = useWorkspaceStore((s) => s.activeId);
  const close = useAttachmentPreviewStore((s) => s.close);
  const [text, setText] = useState<string | null>(null);
  const [textPhase, setTextPhase] = useState<LoadPhase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const [fileUrlPhase, setFileUrlPhase] = useState<LoadPhase>('idle');
  const fallbackAttemptedRef = useRef(false);
  const zoneRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    return registerPreviewDomFocus(() => {
      zoneRef.current?.focus({ preventScroll: true });
    });
  }, []);

  const previewKind = attachmentPreviewKind(attachment);
  const needsFileUrl = attachmentPreviewUsesFileUrl(previewKind);
  const needsText = previewKind === 'text' && isTextPreviewAttachment(attachment);
  const pathInput = useMemo(
    () => attachmentPreviewPathInput(attachment, workspaceId),
    [attachment, workspaceId]
  );

  useEffect(() => {
    fallbackAttemptedRef.current = false;
  }, [attachment.id]);

  useEffect(() => {
    if (!pathInput || !needsFileUrl) {
      setFileUrl(null);
      setFileUrlPhase('idle');
      return;
    }
    let cancelled = false;
    setFileUrl(null);
    setFileUrlPhase('loading');
    setError(null);
    void vyotiq.attachments
      .fileUrl(pathInput)
      .then((url) => {
        if (cancelled) return;
        if (!url) {
          setFileUrl(null);
          setError('Could not resolve a preview URL for this file.');
          return;
        }
        setFileUrl(url);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setFileUrl(null);
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setFileUrlPhase('done');
      });
    return () => {
      cancelled = true;
    };
  }, [needsFileUrl, pathInput]);

  useEffect(() => {
    if (!needsText || !pathInput) {
      setText(null);
      setTextPhase('idle');
      return;
    }
    let cancelled = false;
    setText(null);
    setTextPhase('loading');
    setError(null);
    void vyotiq.attachments
      .readText(pathInput)
      .then((body) => {
        if (!cancelled) setText(body);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setTextPhase('done');
      });
    return () => {
      cancelled = true;
    };
  }, [attachment, needsText, pathInput]);

  useEffect(() => {
    if (fallbackAttemptedRef.current) return;

    const previewable = canPreviewAttachmentInApp(attachment);
    if (!previewable || pathInput === null) {
      fallbackAttemptedRef.current = true;
      void openAttachmentExternal(attachment, workspaceId).then((ok) => {
        if (ok) close();
      });
      return;
    }

    if (needsFileUrl && fileUrlPhase !== 'done') return;
    if (needsText && textPhase !== 'done') return;

    const hasRenderablePreview =
      (needsFileUrl && fileUrl !== null) || (needsText && text !== null);

    if (hasRenderablePreview) return;

    fallbackAttemptedRef.current = true;
    void openAttachmentExternal(attachment, workspaceId).then((ok) => {
      if (ok) close();
    });
  }, [
    attachment,
    close,
    fileUrl,
    fileUrlPhase,
    needsFileUrl,
    needsText,
    pathInput,
    text,
    textPhase,
    workspaceId
  ]);

  const isLoading =
    (needsFileUrl && fileUrlPhase === 'loading') || (needsText && textPhase === 'loading');
  const canPreview = pathInput !== null;

  return (
    <div
      ref={zoneRef}
      tabIndex={-1}
      className={cn(WORKBENCH_BODY_CLASS, 'vx-preview-zone scrollbar-stealth overflow-y-auto outline-none')}
    >
      {isLoading && <LoadingHint message="Loading preview…" />}
      {error && <p className="p-3 text-row text-danger">{error}</p>}
      {previewKind === 'image' && fileUrl && (
        <div className="flex items-center justify-center p-4">
          <img
            src={fileUrl}
            alt={attachment.name}
            className="max-h-full max-w-full rounded-lg object-contain"
          />
        </div>
      )}
      {previewKind === 'pdf' && fileUrl && (
        <iframe title={attachment.name} src={fileUrl} className="min-h-[20rem] flex-1 w-full border-0" />
      )}
      {previewKind === 'video' && fileUrl && (
        <div className="flex items-center justify-center p-4">
          <video
            src={fileUrl}
            controls
            playsInline
            preload="metadata"
            className="max-h-full max-w-full rounded-lg"
          >
            <track kind="captions" />
          </video>
        </div>
      )}
      {previewKind === 'audio' && fileUrl && (
        <div className="flex flex-col items-center justify-center gap-3 p-6">
          <p className="max-w-full truncate font-mono text-row text-text-secondary">{attachment.name}</p>
          <audio src={fileUrl} controls preload="metadata" className="w-full max-w-md">
            <track kind="captions" />
          </audio>
        </div>
      )}
      {previewKind === 'text' && text !== null && (
        <pre className="overflow-auto p-3 font-mono text-log whitespace-pre-wrap text-text-secondary">
          {text}
        </pre>
      )}
      {!isLoading &&
        !error &&
        !canPreview &&
        fallbackAttemptedRef.current && (
          <p className="p-3 text-row text-text-muted">Opening in your default app…</p>
        )}
      {!isLoading &&
        !error &&
        canPreview &&
        previewKind === 'none' &&
        !fallbackAttemptedRef.current && (
          <p className="p-3 text-row text-text-muted">Preview not available for this file type.</p>
        )}
    </div>
  );
}
