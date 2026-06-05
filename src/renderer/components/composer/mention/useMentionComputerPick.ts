import type { MentionRef } from '@shared/types/mention.js';
import { vyotiq } from '../../../lib/ipc.js';
import { randomId } from '../../../lib/ids.js';
import { useToastStore } from '../../../store/useToastStore.js';

export async function pickComputerFileMention(input: {
  conversationId: string;
  workspaceId: string;
  messageId: string;
}): Promise<MentionRef | null> {
  const showToast = useToastStore.getState().show;
  try {
    const ingested = await vyotiq.attachments.pick({
      workspaceId: input.workspaceId,
      conversationId: input.conversationId,
      messageId: input.messageId,
      maxCount: 1
    });
    const meta = ingested[0];
    if (!meta) return null;
    const label = meta.workspacePath ?? meta.name;
    return {
      kind: 'file',
      id: meta.id ?? randomId(),
      label,
      ...(meta.workspacePath ? { workspacePath: meta.workspacePath } : {}),
      ...(meta.storedPath ? { storedPath: meta.storedPath } : {}),
      ...(meta.mimeType ? { mimeType: meta.mimeType } : {}),
      ...(meta.sizeBytes !== undefined ? { sizeBytes: meta.sizeBytes } : {}),
      ...(meta.external ? { external: true } : {})
    };
  } catch (err) {
    showToast(err instanceof Error ? err.message : 'Could not attach file.', 'danger');
    return null;
  }
}
