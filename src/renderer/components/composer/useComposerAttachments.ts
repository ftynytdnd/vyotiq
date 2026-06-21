import { useCallback, useEffect, useRef, useState } from 'react';
import type { PromptAttachmentMeta } from '@shared/types/chat.js';
import { MAX_CHAT_ATTACHMENTS } from '@shared/constants.js';
import {
  looksLikeAbsoluteFilePath,
  normalizeClipboardPath,
  normalizePathComparisonKey,
  parseFileUriList
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
import { ATTACHMENT_ERROR_PASTE_FAILED } from '@shared/attachments/formatAttachmentError.js';
import { toAttachmentIngestPath } from '../../lib/resolveWorkspacePickPath.js';
import { useConversationsStore } from '../../store/useConversationsStore.js';

const ATTACH_NEED_WORKSPACE_TOAST = 'Open a workspace before attaching files.';
const ATTACH_NEED_CHAT_TOAST = 'Could not open a chat for attachments.';

async function resolveAttachmentTarget(
  input: ComposerAttachmentInput
): Promise<{ workspaceId: string; conversationId: string } | null> {
  const workspaceId = input.workspaceId;
  if (!workspaceId) return null;

  let conversationId = input.conversationId;
  if (!conversationId) {
    conversationId =
      (await useConversationsStore.getState().ensureConversationForAttachments(workspaceId)) ??
      null;
  }
  if (!conversationId) return null;
  return { workspaceId, conversationId };
}

function attachmentContextToast(workspaceId: string | null): string {
  return workspaceId ? ATTACH_NEED_CHAT_TOAST : ATTACH_NEED_WORKSPACE_TOAST;
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
  const [ingestCount, setIngestCount] = useState(0);
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

  const withIngesting = useCallback(async <T,>(fn: () => Promise<T>): Promise<T> => {
    setIngestCount((c) => c + 1);
    try {
      return await fn();
    } finally {
      setIngestCount((c) => c - 1);
    }
  }, []);

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
      const ctx = await resolveAttachmentTarget(input);
      if (!ctx) {
        showToast(attachmentContextToast(input.workspaceId), 'danger');
        return;
      }
      const { conversationId, workspaceId } = ctx;
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
        const resolved = collected.paths.map((p) => toAttachmentIngestPath(p, workspaceRoot));
        const ingested = await withIngesting(() =>
          vyotiq.attachments.ingestPaths({
            paths: resolved,
            workspaceId,
            conversationId,
            messageId: ensureMessageId()
          })
        );
        mergeAttachments(ingested);
      } catch (err) {
        showToast(formatAttachmentIngestError(err), 'danger');
      }
    },
    [attachments.length, ensureMessageId, input, mergeAttachments, showToast, withIngesting]
  );

  const addPaths = useCallback(
    async (paths: string[]): Promise<number> => {
      if (paths.length === 0) return 0;
      const ctx = await resolveAttachmentTarget(input);
      if (!ctx) {
        showToast(attachmentContextToast(input.workspaceId), 'danger');
        return 0;
      }
      const { conversationId, workspaceId } = ctx;
      const remaining = MAX_CHAT_ATTACHMENTS - attachments.length;
      if (remaining <= 0) {
        showToast(`Maximum ${MAX_CHAT_ATTACHMENTS} attachments per message.`, 'danger');
        return 0;
      }
      const slice = paths.slice(0, remaining);
      if (slice.length < paths.length) {
        showToast(`Only ${remaining} more attachment(s) allowed (max ${MAX_CHAT_ATTACHMENTS}).`, 'danger');
      }
      const workspaceRoot = useWorkspaceStore.getState().info.path;
      const resolved = slice.map((p) => toAttachmentIngestPath(p, workspaceRoot));
      try {
        const ingested = await withIngesting(() =>
          vyotiq.attachments.ingestPaths({
            paths: resolved,
            workspaceId,
            conversationId,
            messageId: ensureMessageId()
          })
        );
        mergeAttachments(ingested);
        return ingested.length;
      } catch (err) {
        showToast(formatAttachmentIngestError(err), 'danger');
        return 0;
      }
    },
    [attachments.length, ensureMessageId, input, mergeAttachments, showToast, withIngesting]
  );

  const ingestDataTransferFiles = useCallback(
    async (data: DataTransfer) => {
      const ctx = await resolveAttachmentTarget(input);
      if (!ctx) {
        showToast(attachmentContextToast(input.workspaceId), 'danger');
        return false;
      }
      const { conversationId, workspaceId } = ctx;
      const remaining = MAX_CHAT_ATTACHMENTS - attachments.length;
      if (remaining <= 0) {
        showToast(`Maximum ${MAX_CHAT_ATTACHMENTS} attachments per message.`, 'danger');
        return false;
      }

      const clipboardFiles = collectClipboardFiles(data);
      const hostPaths = clipboardFiles
        .map((f) => (f as File & { path?: string }).path)
        .filter((p): p is string => typeof p === 'string' && p.length > 0);

      if (hostPaths.length > 0) {
        const added = await addPaths(hostPaths.slice(0, remaining));
        return added > 0;
      }

      const blobs = await readClipboardFileBlobs(data);
      if (blobs.length > 0) {
        const ingested = await withIngesting(() =>
          ingestClipboardBlobs(
            { conversationId, workspaceId, messageId: ensureMessageId() },
            blobs,
            remaining,
            showToast
          )
        );
        if (ingested.length > 0) {
          mergeAttachments(ingested);
          return true;
        }
      }

      return false;
    },
    [addPaths, attachments.length, ensureMessageId, input, mergeAttachments, showToast, withIngesting]
  );

  const pickFromComputer = useCallback(async () => {
    const ctx = await resolveAttachmentTarget(input);
    if (!ctx) {
      showToast(attachmentContextToast(input.workspaceId), 'danger');
      return;
    }
    const { conversationId, workspaceId } = ctx;
    const remaining = MAX_CHAT_ATTACHMENTS - attachments.length;
    if (remaining <= 0) {
      showToast(`Maximum ${MAX_CHAT_ATTACHMENTS} attachments per message.`, 'danger');
      return;
    }
    try {
      const ingested = await withIngesting(() =>
        vyotiq.attachments.pick({
          workspaceId,
          conversationId,
          messageId: ensureMessageId(),
          maxCount: remaining
        })
      );
      if (ingested.length === 0) return;
      mergeAttachments(ingested);
    } catch (err) {
      showToast(formatAttachmentIngestError(err), 'danger');
    }
  }, [attachments.length, ensureMessageId, input, mergeAttachments, showToast, withIngesting]);

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
        const hostPaths = files
          .map((f) => (f as File & { path?: string }).path)
          .filter((p): p is string => typeof p === 'string' && p.length > 0);
        const attached = await ingestDataTransferFiles(e.dataTransfer);
        if (!attached && hostPaths.length === 0) {
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
      const remaining = MAX_CHAT_ATTACHMENTS - attachments.length;
      if (remaining <= 0) {
        showToast(`Maximum ${MAX_CHAT_ATTACHMENTS} attachments per message.`, 'danger');
        return;
      }

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
          const ctx = await resolveAttachmentTarget(input);
          if (!ctx) {
            showToast(attachmentContextToast(input.workspaceId), 'danger');
            return;
          }
          const { conversationId, workspaceId } = ctx;
          const triedPathKeys = new Set<string>();

          if (hostPaths.length > 0) {
            const slice = hostPaths.slice(0, remaining);
            for (const p of slice) triedPathKeys.add(normalizePathComparisonKey(p));
            if (slice.length < hostPaths.length) {
              showToast(
                `Only ${remaining} more attachment(s) allowed (max ${MAX_CHAT_ATTACHMENTS}).`,
                'danger'
              );
            }
            const added = await addPaths(slice);
            if (added > 0) return;
          }

          const uriListPaths = parseFileUriList(e.clipboardData.getData('text/uri-list'));
          if (uriListPaths.length > 0) {
            const added = await addPaths(uriListPaths.slice(0, remaining));
            if (added > 0) return;
          }

          if (hasFilePathText) {
            const pathKey = normalizePathComparisonKey(plainText);
            if (!triedPathKeys.has(pathKey)) {
              triedPathKeys.add(pathKey);
              const workspaceRoot = useWorkspaceStore.getState().info.path;
              const ingested = await withIngesting(() =>
                vyotiq.attachments.ingestPaths({
                  paths: [toAttachmentIngestPath(normalizeClipboardPath(plainText), workspaceRoot)],
                  workspaceId,
                  conversationId,
                  messageId: ensureMessageId()
                })
              );
              if (ingested.length > 0) {
                mergeAttachments(ingested);
                return;
              }
            }
          }

          if (clipboardFiles.length > 0 || hasImagePayload) {
            const blobs = await readClipboardFileBlobs(e.clipboardData);
            const ingested = await withIngesting(() =>
              ingestClipboardBlobs(
                { conversationId, workspaceId, messageId: ensureMessageId() },
                blobs,
                remaining,
                showToast
              )
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

          const ingested = await withIngesting(() =>
            vyotiq.attachments.ingestClipboard({
              workspaceId,
              conversationId,
              messageId: ensureMessageId()
            })
          );
          if (ingested.length > 0) {
            mergeAttachments(ingested);
            return;
          }

          showToast(ATTACHMENT_ERROR_PASTE_FAILED, 'danger');
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
      showToast,
      withIngesting
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
    isIngesting: ingestCount > 0,
    pendingMessageId: pendingMessageIdRef,
    peekPendingMessageId: ensureMessageId
  };
}
