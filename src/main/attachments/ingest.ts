/**
 * External attachment ingest — copies files into app userData under
 * `attachments/{workspaceId}/{conversationId}/{messageId}/` under `<userData>/vyotiq/attachments/`.
 */

import { copyFile, mkdir, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { PromptAttachmentMeta } from '@shared/types/chat.js';
import {
  MAX_ATTACHMENT_FILE_BYTES,
  MAX_CHAT_ATTACHMENTS,
  VISION_VIDEO_MAX_BYTES
} from '@shared/constants.js';
import { guessMimeFromName, mediaKindFromMeta } from '@shared/attachments/mediaKind.js';

import { attachmentsDir } from '../paths/userDataLayout.js';

export function attachmentsRoot(): string {
  return attachmentsDir();
}

function messageDir(workspaceId: string, conversationId: string, messageId: string): string {
  return join(attachmentsRoot(), workspaceId, conversationId, messageId);
}

export interface IngestFileInput {
  sourcePath: string;
  workspaceId: string;
  conversationId: string;
  messageId: string;
  /** When set, file stays in the workspace (not copied into userData). */
  workspacePath?: string;
}

export async function ingestExternalFile(input: IngestFileInput): Promise<PromptAttachmentMeta> {
  const st = await stat(input.sourcePath);
  if (!st.isFile()) {
    throw new Error('Not a file');
  }

  const name = basename(input.sourcePath);
  const mimeType = guessMimeFromName(name);
  const mediaKind = mediaKindFromMeta({ name, mimeType });
  const sizeCap =
    mediaKind === 'video' ? VISION_VIDEO_MAX_BYTES : MAX_ATTACHMENT_FILE_BYTES;
  if (st.size > sizeCap) {
    throw new Error(`File exceeds ${sizeCap / (1024 * 1024)} MB limit`);
  }

  if (input.workspacePath) {
    return {
      id: randomUUID(),
      name,
      mimeType,
      mediaKind,
      sizeBytes: st.size,
      workspacePath: input.workspacePath,
      external: false
    };
  }

  const dir = messageDir(input.workspaceId, input.conversationId, input.messageId);
  await mkdir(dir, { recursive: true });
  const safeName = name.replace(/[^\w.\-()+ ]/g, '_').slice(0, 180) || 'file';
  const dest = join(dir, `${randomUUID().slice(0, 8)}-${safeName}`);
  await copyFile(input.sourcePath, dest);

  return {
    id: randomUUID(),
    name,
    mimeType,
    mediaKind,
    sizeBytes: st.size,
    storedPath: dest,
    external: true
  };
}

export function assertAttachmentCount(count: number): void {
  if (count > MAX_CHAT_ATTACHMENTS) {
    throw new Error(`Maximum ${MAX_CHAT_ATTACHMENTS} attachments per message`);
  }
}
