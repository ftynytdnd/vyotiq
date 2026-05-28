/**
 * In-app preview for images, PDFs, and text attachments.
 * Unsupported types or failed loads fall back to the OS default app.
 */

import { FloatingPanel } from '../ui/FloatingPanel.js';
import { LoadingHint } from '../ui/LoadingHint.js';
import { useEffect, useMemo, useRef, useState } from 'react';
import { vyotiq } from '../../lib/ipc.js';
import type { PromptAttachmentMeta } from '@shared/types/chat.js';
import { useWorkspaceStore } from '../../store/useWorkspaceStore.js';
import {
  attachmentPreviewPathInput,
  canPreviewAttachmentInApp,
  openAttachmentExternal
} from '../../lib/openAttachment.js';

interface AttachmentPreviewPanelProps {
  open: boolean;
  onClose: () => void;
  attachment: PromptAttachmentMeta | null;
  initialWidth?: number;
  onWidthChange?: (w: number) => void;
}

export function AttachmentPreviewPanel({
  open,
  onClose,
  attachment,
  initialWidth,
  onWidthChange
}: AttachmentPreviewPanelProps) {
  const workspaceId = useWorkspaceStore((s) => s.activeId);
  const [text, setText] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const [fileUrlLoading, setFileUrlLoading] = useState(false);
  const fallbackAttemptedRef = useRef(false);

  const pathInput = useMemo(
    () => (attachment ? attachmentPreviewPathInput(attachment, workspaceId) : null),
    [attachment, workspaceId]
  );

  useEffect(() => {
    fallbackAttemptedRef.current = false;
  }, [attachment?.id, open]);

  useEffect(() => {
    if (!open || !pathInput) {
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
  }, [open, pathInput]);

  useEffect(() => {
    if (!open || !attachment) {
      setText(null);
      setError(null);
      return;
    }
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
  }, [open, attachment, pathInput]);

  useEffect(() => {
    if (!open || !attachment || fallbackAttemptedRef.current) return;

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
      if (ok) onClose();
    });
  }, [
    attachment,
    error,
    fileUrl,
    fileUrlLoading,
    loading,
    onClose,
    open,
    pathInput,
    text,
    workspaceId
  ]);

  if (!attachment) return null;

  const mime = attachment.mimeType ?? '';
  const isImage = mime.startsWith('image/');
  const src = fileUrl;
  const canPreview = pathInput !== null;

  return (
    <FloatingPanel
      open={open}
      onClose={onClose}
      title={attachment.name}
      widthKey="attachmentPreview"
      initialWidth={initialWidth}
      onWidthChange={onWidthChange}
      showBackdrop={false}
      className="vx-attachment-preview"
    >
      {loading && <LoadingHint message="Loading preview…" />}
      {error && <p className="p-3 text-row text-danger">{error}</p>}
      {isImage && src && (
        <div className="flex items-center justify-center p-4">
          <img
            src={src}
            alt={attachment.name}
            className="max-h-[70vh] max-w-full rounded-lg object-contain"
          />
        </div>
      )}
      {mime === 'application/pdf' && src && (
        <iframe title={attachment.name} src={src} className="h-[min(70vh,600px)] w-full border-0" />
      )}
      {text !== null && (
        <pre className="max-h-[70vh] overflow-auto p-3 font-mono text-log whitespace-pre-wrap text-text-secondary">
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
    </FloatingPanel>
  );
}
