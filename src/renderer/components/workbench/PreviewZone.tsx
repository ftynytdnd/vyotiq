/**
 * Attachment preview body for the Globe workbench tab.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { LoadingHint } from '../ui/LoadingHint.js';
import { vyotiq } from '../../lib/ipc.js';
import type { PromptAttachmentMeta } from '@shared/types/chat.js';
import { useWorkspaceStore } from '../../store/useWorkspaceStore.js';
import {
  attachmentPreviewPathInput,
  canPreviewAttachmentInApp,
  openAttachmentExternal
} from '../../lib/openAttachment.js';
import { useAttachmentPreviewStore } from '../../store/useAttachmentPreviewStore.js';
import { cn } from '../../lib/cn.js';
import { WORKBENCH_BODY_CLASS } from './workbenchShared.js';

export interface PreviewZoneProps {
  attachment: PromptAttachmentMeta;
}

export function PreviewZone({ attachment }: PreviewZoneProps) {
  const workspaceId = useWorkspaceStore((s) => s.activeId);
  const close = useAttachmentPreviewStore((s) => s.close);
  const [text, setText] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const [fileUrlLoading, setFileUrlLoading] = useState(false);
  const fallbackAttemptedRef = useRef(false);

  const pathInput = useMemo(
    () => attachmentPreviewPathInput(attachment, workspaceId),
    [attachment, workspaceId]
  );

  useEffect(() => {
    fallbackAttemptedRef.current = false;
  }, [attachment.id]);

  useEffect(() => {
    if (!pathInput) {
      setFileUrl(null);
      setFileUrlLoading(false);
      return;
    }
    let cancelled = false;
    setFileUrlLoading(true);
    void vyotiq.attachments
      .fileUrl(pathInput)
      .then((url) => {
        if (!cancelled) setFileUrl(url);
      })
      .catch(() => {
        if (!cancelled) setFileUrl(null);
      })
      .finally(() => {
        if (!cancelled) setFileUrlLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [pathInput]);

  useEffect(() => {
    const mime = attachment.mimeType ?? '';
    const isText =
      mime.startsWith('text/') ||
      /\.(txt|md|json|ya?ml|xml|csv|log|ts|tsx|js|jsx|mjs|cjs|py|rs|go|java|kt|cs|cpp|c|h|css|html?)$/i.test(
        attachment.name
      );
    if (!isText || !pathInput) {
      setText(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
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
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [attachment, pathInput]);

  useEffect(() => {
    if (fallbackAttemptedRef.current) return;

    const mime = attachment.mimeType ?? '';
    const isImage = mime.startsWith('image/');
    const isPdf = mime === 'application/pdf';
    const previewable = canPreviewAttachmentInApp(attachment);
    const hasRenderablePreview =
      (isImage && fileUrl) ||
      (isPdf && fileUrl) ||
      text !== null;

    if (loading || fileUrlLoading || hasRenderablePreview) return;

    const shouldFallback =
      !previewable ||
      pathInput === null ||
      error !== null ||
      ((isImage || isPdf) && !fileUrl) ||
      (previewable && !isImage && !isPdf && text === null);

    if (!shouldFallback) return;

    fallbackAttemptedRef.current = true;
    void openAttachmentExternal(attachment, workspaceId).then((ok) => {
      if (ok) close();
    });
  }, [
    attachment,
    close,
    error,
    fileUrl,
    fileUrlLoading,
    loading,
    pathInput,
    text,
    workspaceId
  ]);

  const mime = attachment.mimeType ?? '';
  const isImage = mime.startsWith('image/');
  const src = fileUrl;
  const canPreview = pathInput !== null;

  return (
    <div className={cn(WORKBENCH_BODY_CLASS, 'vx-preview-zone scrollbar-stealth overflow-y-auto')}>
      {loading && <LoadingHint message="Loading preview…" />}
      {error && <p className="p-3 text-row text-danger">{error}</p>}
      {isImage && src && (
        <div className="flex items-center justify-center p-4">
          <img
            src={src}
            alt={attachment.name}
            className="max-h-full max-w-full rounded-lg object-contain"
          />
        </div>
      )}
      {mime === 'application/pdf' && src && (
        <iframe title={attachment.name} src={src} className="min-h-[20rem] flex-1 w-full border-0" />
      )}
      {text !== null && (
        <pre className="overflow-auto p-3 font-mono text-log whitespace-pre-wrap text-text-secondary">
          {text}
        </pre>
      )}
      {!loading &&
        !error &&
        !canPreview &&
        fallbackAttemptedRef.current && (
          <p className="p-3 text-row text-text-muted">Opening in your default app…</p>
        )}
      {!loading &&
        !error &&
        canPreview &&
        !isImage &&
        mime !== 'application/pdf' &&
        text === null &&
        !fallbackAttemptedRef.current && (
          <p className="p-3 text-row text-text-muted">Preview not available for this file type.</p>
        )}
    </div>
  );
}
