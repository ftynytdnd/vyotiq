import { useCallback, useEffect, useRef, useState } from 'react';
import type { PromptAttachmentMeta } from '@shared/types/chat.js';
import { MAX_CHAT_ATTACHMENTS } from '@shared/constants.js';
import { randomId } from '../../lib/ids.js';
import { vyotiq } from '../../lib/ipc.js';
import { useToastStore } from '../../store/useToastStore.js';
import { useWorkspaceStore } from '../../store/useWorkspaceStore.js';

function resolvePickPath(path: string, workspaceRoot: string | null): string {
  if (!workspaceRoot) return path;
  if (/^[a-zA-Z]:[\\/]/.test(path) || path.startsWith('/')) return path;
  const sep = workspaceRoot.includes('\\') ? '\\' : '/';
  return `${workspaceRoot.replace(/[/\\]+$/, '')}${sep}${path.replace(/^[/\\]+/, '')}`;
}

function attachmentPathKey(meta: PromptAttachmentMeta): string {
  return meta.workspacePath ?? meta.storedPath ?? meta.id;
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
        showToast(err instanceof Error ? err.message : 'Could not attach folder.', 'danger');
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
        showToast(err instanceof Error ? err.message : 'Could not attach files.', 'danger');
      }
    },
    [attachments.length, ensureMessageId, input, mergeAttachments, showToast]
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
      const paths = files
        .map((f) => (f as File & { path?: string }).path)
        .filter((p): p is string => typeof p === 'string' && p.length > 0);
      if (paths.length === 0) {
        showToast('Drop files from your desktop or file manager.', 'danger');
        return;
      }
      void addPaths(paths);
    },
    [addPaths, showToast]
  );

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }, []);

  const onPaste = useCallback(
    (e: React.ClipboardEvent) => {
      const files = Array.from(e.clipboardData.files);
      if (files.length === 0) return;
      e.preventDefault();
      const paths = files
        .map((f) => (f as File & { path?: string }).path)
        .filter((p): p is string => typeof p === 'string' && p.length > 0);
      if (paths.length > 0) {
        void addPaths(paths);
        return;
      }
      void pickFromComputer();
    },
    [addPaths, pickFromComputer]
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
    pendingMessageId: pendingMessageIdRef,
    peekPendingMessageId: ensureMessageId
  };
}
