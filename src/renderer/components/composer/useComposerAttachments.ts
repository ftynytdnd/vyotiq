import { useCallback, useEffect, useRef, useState } from 'react';
import type { PromptAttachmentMeta } from '@shared/types/chat.js';
import { MAX_CHAT_ATTACHMENTS } from '@shared/constants.js';
import {
  looksLikeAbsoluteFilePath,
  normalizeClipboardPath
} from '@shared/attachments/clipboardFilePaths.js';
import { filterClipboardBlobsWithinLimits } from '@shared/attachments/clipboardBlobLimits.js';
import {
  parseClipboardHttpUrl,
  urlAttachmentLabel
} from '@shared/attachments/clipboardUrl.js';
import { randomId } from '../../lib/ids.js';
import { vyotiq } from '../../lib/ipc.js';
import { useToastStore } from '../../store/useToastStore.js';
import { useWorkspaceStore } from '../../store/useWorkspaceStore.js';
import {
  clipboardHasImagePayload,
  collectClipboardFiles,
  readClipboardFileBlobs
} from './collectClipboardFiles.js';
import { formatAttachmentIngestError } from './formatAttachmentIngestError.js';

function resolvePickPath(path: string, workspaceRoot: string | null): string {
  if (!workspaceRoot) return path;
  if (/^[a-zA-Z]:[\\/]/.test(path) || path.startsWith('/')) return path;
  const sep = workspaceRoot.includes('\\') ? '\\' : '/';
  return `${workspaceRoot.replace(/[/\\]+$/, '')}${sep}${path.replace(/^[/\\]+/, '')}`;
}

function attachmentPathKey(meta: PromptAttachmentMeta): string {
  return meta.sourceUrl ?? meta.workspacePath ?? meta.storedPath ?? meta.id;
}

function createUrlAttachment(url: string): PromptAttachmentMeta {
  return {
    id: randomId(),
    name: urlAttachmentLabel(url),
    mimeType: 'text/uri-list',
    mediaKind: 'text',
    sourceUrl: url,
    external: true
  };
}

export interface ComposerAttachmentInput {
  conversationId: string | null;
  workspaceId: string | null;
}

async function ingestClipboardBlobs(
  input: ComposerAttachmentInput & { messageId: string },
  blobs: Array<{ name: string; mimeType: string; data: ArrayBuffer }>,
  remaining: number,
  showToast: (message: string, variant: 'danger' | 'success' | 'info') => void
): Promise<PromptAttachmentMeta[]> {
  const { accepted, rejected } = filterClipboardBlobsWithinLimits(blobs);
  if (rejected.length > 0) {
    showToast(
      `${rejected.length} pasted file(s) exceed the size limit and were skipped.`,
      'danger'
    );
  }
  if (accepted.length === 0) return [];

  const slice = accepted.slice(0, remaining);
  if (slice.length < accepted.length) {
    showToast(
      `Only ${remaining} more attachment(s) allowed (max ${MAX_CHAT_ATTACHMENTS}).`,
      'danger'
    );
  }

  return vyotiq.attachments.ingestClipboard({
    workspaceId: input.workspaceId!,
    conversationId: input.conversationId!,
    messageId: input.messageId,
    blobs: slice.map((blob) => ({
      name: blob.name,
      mimeType: blob.mimeType,
      data: new Uint8Array(blob.data)
    }))
  });
}

export function useComposerAttachments(input: {
  conversationId: string | null;
  workspaceId: string | null;
  initialAttachments?: PromptAttachmentMeta[];
  onAttachmentsChange?: (attachments: PromptAttachmentMeta[]) => void;
}) {
  const [attachments, setAttachmentsState] = useState<PromptAttachmentMeta[]>(
    () => input.initialAttachments ?? []
  );
  const pendingMessageIdRef = useRef(randomId());
  const showToast = useToastStore((s) => s.show);
  const hydratedConvRef = useRef<string | null>(null);

  useEffect(() => {
    if (input.conversationId === hydratedConvRef.current) return;
    hydratedConvRef.current = input.conversationId;
    setAttachmentsState(input.initialAttachments ?? []);
    pendingMessageIdRef.current = randomId();
  }, [input.conversationId, input.initialAttachments]);

  const setAttachments = useCallback(
    (next: PromptAttachmentMeta[] | ((cur: PromptAttachmentMeta[]) => PromptAttachmentMeta[])) => {
      setAttachmentsState((cur) => {
        const resolved = typeof next === 'function' ? next(cur) : next;
        input.onAttachmentsChange?.(resolved);
        return resolved;
      });
    },
    [input.onAttachmentsChange]
  );

  const ensureMessageId = useCallback(() => {
    if (!pendingMessageIdRef.current) {
      pendingMessageIdRef.current = randomId();
    }
    return pendingMessageIdRef.current;
  }, []);

  const clearAttachments = useCallback(() => {
    setAttachments([]);
    pendingMessageIdRef.current = randomId();
  }, [setAttachments]);

  const mergeAttachments = useCallback(
    (ingested: PromptAttachmentMeta[]) => {
      setAttachments((cur) => {
        const byPath = new Map(cur.map((a) => [attachmentPathKey(a), a]));
        for (const a of ingested) {
          byPath.set(attachmentPathKey(a), a);
        }
        return Array.from(byPath.values()).slice(0, MAX_CHAT_ATTACHMENTS);
      });
    },
    [setAttachments]
  );

  const addUrlAttachment = useCallback(
    (url: string) => {
      mergeAttachments([createUrlAttachment(url)]);
    },
    [mergeAttachments]
  );

  const addFolder = useCallback(
    async (folderPath: string) => {
      const { conversationId, workspaceId } = input;
      if (!conversationId || !workspaceId) {
        showToast('Open a workspace and conversation before attaching files.', 'danger');
        return;
      }
      const remaining = MAX_CHAT_ATTACHMENTS - attachments.length;
      if (remaining <= 0) {
        showToast(`Maximum ${MAX_CHAT_ATTACHMENTS} attachments per message.`, 'danger');
        return;
      }
      try {
        const collected = await vyotiq.attachments.collectFolder({
          workspaceId,
          folderPath,
          maxCount: remaining
        });
        if (collected.paths.length === 0) {
          showToast('No attachable files in that folder.', 'danger');
          return;
        }
        if (collected.truncated) {
          showToast(
            `Folder has ${collected.total} files; attaching ${collected.paths.length} (max ${MAX_CHAT_ATTACHMENTS} per message).`,
            'danger'
          );
        }
        const workspaceRoot = useWorkspaceStore.getState().info.path;
        const resolved = collected.paths.map((p) => resolvePickPath(p, workspaceRoot));
        const ingested = await vyotiq.attachments.ingestPaths({
          paths: resolved,
          workspaceId,
          conversationId,
          messageId: ensureMessageId()
        });
        mergeAttachments(ingested);
      } catch (err) {
        showToast(formatAttachmentIngestError(err), 'danger');
      }
    },
    [attachments.length, ensureMessageId, input, mergeAttachments, showToast]
  );

  const addPaths = useCallback(
    async (paths: string[]) => {
      if (paths.length === 0) return;
      const { conversationId, workspaceId } = input;
      if (!conversationId || !workspaceId) {
        showToast('Open a workspace and conversation before attaching files.', 'danger');
        return;
      }
      const remaining = MAX_CHAT_ATTACHMENTS - attachments.length;
      if (remaining <= 0) {
        showToast(`Maximum ${MAX_CHAT_ATTACHMENTS} attachments per message.`, 'danger');
        return;
      }
      const slice = paths.slice(0, remaining);
      if (slice.length < paths.length) {
        showToast(`Only ${remaining} more attachment(s) allowed (max ${MAX_CHAT_ATTACHMENTS}).`, 'danger');
      }
      const workspaceRoot = useWorkspaceStore.getState().info.path;
      const resolved = slice.map((p) => resolvePickPath(p, workspaceRoot));
      try {
        const ingested = await vyotiq.attachments.ingestPaths({
          paths: resolved,
          workspaceId,
          conversationId,
          messageId: ensureMessageId()
        });
        mergeAttachments(ingested);
      } catch (err) {
        showToast(formatAttachmentIngestError(err), 'danger');
      }
    },
    [attachments.length, ensureMessageId, input, mergeAttachments, showToast]
  );

  const ingestDataTransferFiles = useCallback(
    async (data: DataTransfer) => {
      const { conversationId, workspaceId } = input;
      if (!conversationId || !workspaceId) return false;
      const remaining = MAX_CHAT_ATTACHMENTS - attachments.length;
      if (remaining <= 0) return false;

      const clipboardFiles = collectClipboardFiles(data);
      const hostPaths = clipboardFiles
        .map((f) => (f as File & { path?: string }).path)
        .filter((p): p is string => typeof p === 'string' && p.length > 0);

      if (hostPaths.length > 0) {
        await addPaths(hostPaths.slice(0, remaining));
        return true;
      }

      const blobs = await readClipboardFileBlobs(data);
      if (blobs.length > 0) {
        const ingested = await ingestClipboardBlobs(
          { conversationId, workspaceId, messageId: ensureMessageId() },
          blobs,
          remaining,
          showToast
        );
        if (ingested.length > 0) {
          mergeAttachments(ingested);
          return true;
        }
      }

      return false;
    },
    [addPaths, attachments.length, ensureMessageId, input, mergeAttachments, showToast]
  );

  const pickFromComputer = useCallback(async () => {
    const { conversationId, workspaceId } = input;
    if (!conversationId || !workspaceId) {
      showToast('Open a workspace and conversation before attaching files.', 'danger');
      return;
    }
    const remaining = MAX_CHAT_ATTACHMENTS - attachments.length;
    if (remaining <= 0) {
      showToast(`Maximum ${MAX_CHAT_ATTACHMENTS} attachments per message.`, 'danger');
      return;
    }
    try {
      const ingested = await vyotiq.attachments.pick({
        workspaceId,
        conversationId,
        messageId: ensureMessageId(),
        maxCount: remaining
      });
      if (ingested.length === 0) return;
      mergeAttachments(ingested);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not attach files.', 'danger');
    }
  }, [attachments.length, ensureMessageId, input, mergeAttachments, showToast]);

  const remove = useCallback(
    (id: string) => {
      setAttachments((cur) => cur.filter((a) => a.id !== id));
    },
    [setAttachments]
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const files = Array.from(e.dataTransfer.files);
      if (files.length === 0) return;

      void (async () => {
        const attached = await ingestDataTransferFiles(e.dataTransfer);
        if (!attached) {
          showToast('Could not attach dropped files.', 'danger');
        }
      })();
    },
    [ingestDataTransferFiles, showToast]
  );

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }, []);

  const onPaste = useCallback(
    (e: React.ClipboardEvent) => {
      const { conversationId, workspaceId } = input;
      if (!conversationId || !workspaceId) return;
      const remaining = MAX_CHAT_ATTACHMENTS - attachments.length;
      if (remaining <= 0) return;

      const plainText = e.clipboardData.getData('text/plain').trim();
      const clipboardFiles = collectClipboardFiles(e.clipboardData);
      const hostPaths = clipboardFiles
        .map((f) => (f as File & { path?: string }).path)
        .filter((p): p is string => typeof p === 'string' && p.length > 0);
      const hasFilePathText = plainText.length > 0 && looksLikeAbsoluteFilePath(plainText);
      const hasImagePayload = clipboardHasImagePayload(e.clipboardData);
      const clipboardUrl = plainText.length > 0 ? parseClipboardHttpUrl(plainText) : null;

      if (
        plainText.length > 0 &&
        !hasFilePathText &&
        !hasImagePayload &&
        hostPaths.length === 0 &&
        clipboardFiles.length === 0 &&
        !clipboardUrl
      ) {
        return;
      }

      const shouldAttach =
        hostPaths.length > 0 ||
        hasFilePathText ||
        hasImagePayload ||
        clipboardFiles.length > 0 ||
        clipboardUrl !== null;

      if (!shouldAttach) return;

      e.preventDefault();

      void (async () => {
        try {
          if (hostPaths.length > 0) {
            const slice = hostPaths.slice(0, remaining);
            if (slice.length < hostPaths.length) {
              showToast(
                `Only ${remaining} more attachment(s) allowed (max ${MAX_CHAT_ATTACHMENTS}).`,
                'danger'
              );
            }
            await addPaths(slice);
            return;
          }

          if (hasFilePathText) {
            const ingested = await vyotiq.attachments.ingestPaths({
              paths: [normalizeClipboardPath(plainText)],
              workspaceId,
              conversationId,
              messageId: ensureMessageId()
            });
            if (ingested.length > 0) {
              mergeAttachments(ingested);
              return;
            }
          }

          if (clipboardFiles.length > 0 || hasImagePayload) {
            const blobs = await readClipboardFileBlobs(e.clipboardData);
            const ingested = await ingestClipboardBlobs(
              { conversationId, workspaceId, messageId: ensureMessageId() },
              blobs,
              remaining,
              showToast
            );
            if (ingested.length > 0) {
              mergeAttachments(ingested);
              return;
            }
          }

          if (clipboardUrl) {
            addUrlAttachment(clipboardUrl);
            return;
          }

          const ingested = await vyotiq.attachments.ingestClipboard({
            workspaceId,
            conversationId,
            messageId: ensureMessageId()
          });
          if (ingested.length > 0) {
            mergeAttachments(ingested);
            return;
          }

          showToast('Could not paste file from clipboard.', 'danger');
        } catch (err) {
          showToast(formatAttachmentIngestError(err), 'danger');
        }
      })();
    },
    [
      addPaths,
      addUrlAttachment,
      attachments.length,
      ensureMessageId,
      input,
      mergeAttachments,
      showToast
    ]
  );

  return {
    attachments,
    setAttachments,
    addPaths,
    addFolder,
    pickFromComputer,
    remove,
    clearAttachments,
    onDrop,
    onDragOver,
    onPaste,
    ingestDataTransferFiles,
    pendingMessageId: pendingMessageIdRef,
    peekPendingMessageId: ensureMessageId
  };
}
