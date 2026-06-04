import { useCallback, useRef, useState } from 'react';
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

export function useComposerAttachments(input: {
  conversationId: string | null;
  workspaceId: string | null;
  /** Seeds attachment pills when opening inline edit (not persisted as draft). */
  initialAttachments?: PromptAttachmentMeta[];
}) {
  const [attachments, setAttachments] = useState<PromptAttachmentMeta[]>(
    () => input.initialAttachments ?? []
  );
  const pendingMessageIdRef = useRef(randomId());
  const showToast = useToastStore((s) => s.show);

  const ensureMessageId = useCallback(() => {
    if (!pendingMessageIdRef.current) {
      pendingMessageIdRef.current = randomId();
    }
    return pendingMessageIdRef.current;
  }, []);

  const clearAttachments = useCallback(() => {
    setAttachments([]);
    pendingMessageIdRef.current = randomId();
  }, []);

  const mergeAttachments = useCallback((ingested: PromptAttachmentMeta[]) => {
    setAttachments((cur) => {
      const ids = new Set(cur.map((a) => a.id));
      const next = [...cur];
      for (const a of ingested) {
        if (!ids.has(a.id)) next.push(a);
      }
      return next.slice(0, MAX_CHAT_ATTACHMENTS);
    });
  }, []);

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

  const remove = useCallback((id: string) => {
    setAttachments((cur) => cur.filter((a) => a.id !== id));
  }, []);

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

  return {
    attachments,
    setAttachments,
    addPaths,
    pickFromComputer,
    remove,
    clearAttachments,
    onDrop,
    onDragOver,
    pendingMessageId: pendingMessageIdRef,
    peekPendingMessageId: ensureMessageId
  };
}
