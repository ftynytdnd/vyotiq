/**
 * Dock unified-search file actions — preview in-app or attach to composer.
 */

import { isEditableTextFile } from '@shared/text/isEditableTextFile.js';
import { basenameFromPath } from '@shared/text/languageFromPath.js';
import type { PromptAttachmentMeta } from '@shared/types/chat.js';
import { MAX_CHAT_ATTACHMENTS } from '@shared/constants.js';
import { randomId } from '../../lib/ids.js';
import { vyotiq } from '../../lib/ipc.js';
import { openAttachment } from '../../lib/openAttachment.js';
import { openWorkspaceFileInEditor } from '../../lib/openWorkspaceFileInEditor.js';
import { formatAttachmentIngestError } from '../composer/formatAttachmentIngestError.js';
import { useChatStore } from '../../store/useChatStore.js';
import { useToastStore } from '../../store/useToastStore.js';
import { useWorkspaceStore } from '../../store/useWorkspaceStore.js';
import { resolveWorkspacePickPath } from '../../lib/resolveWorkspacePickPath.js';

function workspaceFileMeta(path: string): PromptAttachmentMeta {
  return {
    id: `dock-preview:${path}`,
    name: basenameFromPath(path),
    workspacePath: path
  };
}

function mergeAttachmentDraft(
  conversationId: string,
  ingested: PromptAttachmentMeta[]
): void {
  const chat = useChatStore.getState();
  const slice = chat.slices[conversationId];
  const current = slice?.attachmentDraft ?? [];
  const byPath = new Map(
    current.map((a) => [a.workspacePath ?? a.storedPath ?? a.id, a])
  );
  for (const a of ingested) {
    byPath.set(a.workspacePath ?? a.storedPath ?? a.id, a);
  }
  chat.setAttachmentDraft(conversationId, Array.from(byPath.values()).slice(0, MAX_CHAT_ATTACHMENTS));
}

/** Open preview panel when supported; otherwise OS default. */
export async function previewDockWorkspaceFile(path: string): Promise<void> {
  const workspaceId = useWorkspaceStore.getState().activeId;
  if (workspaceId && isEditableTextFile(path)) {
    const opened = await openWorkspaceFileInEditor(path, { workspaceId });
    if (opened) return;
  }
  await openAttachment(workspaceFileMeta(path), workspaceId);
}

/** Attach a workspace file to the active conversation draft when possible. */
export async function attachDockWorkspaceFile(path: string): Promise<boolean> {
  const showToast = useToastStore.getState().show;
  const workspaceId = useWorkspaceStore.getState().activeId;
  const conversationId = useChatStore.getState().conversationId;
  if (!workspaceId || !conversationId) {
    showToast('Open a workspace and conversation before attaching files.', 'danger');
    return false;
  }

  const slice = useChatStore.getState().slices[conversationId];
  const currentCount = slice?.attachmentDraft?.length ?? 0;
  if (currentCount >= MAX_CHAT_ATTACHMENTS) {
    showToast(`Maximum ${MAX_CHAT_ATTACHMENTS} attachments per message.`, 'danger');
    return false;
  }

  const workspaceRoot = useWorkspaceStore.getState().info.path;
  const resolved = resolveWorkspacePickPath(path, workspaceRoot);

  try {
    const ingested = await vyotiq.attachments.ingestPaths({
      paths: [resolved],
      workspaceId,
      conversationId,
      messageId: randomId()
    });
    mergeAttachmentDraft(conversationId, ingested);
    return true;
  } catch (err) {
    showToast(formatAttachmentIngestError(err), 'danger');
    return false;
  }
}
