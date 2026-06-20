/**
 * Attachment open helpers — in-app preview first, OS default app fallback.
 */

import { isEditableTextFile } from '@shared/text/isEditableTextFile.js';
import type { PromptAttachmentMeta } from '@shared/types/chat.js';
import { vyotiq } from './ipc.js';
import { openWorkspaceFileInEditor } from './openWorkspaceFileInEditor.js';
import { openWorkspaceFile } from './openPath.js';
import { useToastStore } from '../store/useToastStore.js';
import { useAttachmentPreviewStore } from '../store/useAttachmentPreviewStore.js';
import {
  attachmentPreviewKind,
  canPreviewAttachmentInApp as canPreviewAttachmentInAppKind
} from './attachmentPreview.js';

export {
  attachmentMediaKind,
  attachmentPreviewKind,
  attachmentPreviewUsesFileUrl,
  canPreviewAttachmentInApp
} from './attachmentPreview.js';

export function attachmentPreviewPathInput(
  attachment: PromptAttachmentMeta,
  workspaceId: string | null
): string | { path: string; workspaceId?: string } | null {
  if (attachment.storedPath) return attachment.storedPath;
  if (attachment.workspacePath && workspaceId) {
    return { path: attachment.workspacePath, workspaceId };
  }
  return null;
}

export async function openAttachmentExternal(
  attachment: PromptAttachmentMeta,
  workspaceId: string | null
): Promise<boolean> {
  if (attachment.workspacePath && workspaceId) {
    return openWorkspaceFile(attachment.workspacePath, {
      workspaceId,
      context: 'attachment',
      forceExternal: true
    });
  }
  if (attachment.storedPath) {
    try {
      await vyotiq.attachments.open(attachment.storedPath);
      return true;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      useToastStore.getState().show(`Could not open ${attachment.name}: ${msg}`, 'danger');
      return false;
    }
  }
  useToastStore.getState().show(`Preview not available for ${attachment.name}.`, 'danger');
  return false;
}

/** Open in the floating preview panel when supported; otherwise OS default. */
export async function openAttachment(
  attachment: PromptAttachmentMeta,
  workspaceId: string | null
): Promise<void> {
  if (
    attachment.workspacePath &&
    workspaceId &&
    isEditableTextFile(attachment.workspacePath)
  ) {
    const opened = await openWorkspaceFileInEditor(attachment.workspacePath, { workspaceId });
    if (opened) return;
  }

  if (!canPreviewAttachmentInAppKind(attachment)) {
    await openAttachmentExternal(attachment, workspaceId);
    return;
  }
  if (attachmentPreviewPathInput(attachment, workspaceId) === null) {
    await openAttachmentExternal(attachment, workspaceId);
    return;
  }
  useAttachmentPreviewStore.getState().open(attachment);
}
