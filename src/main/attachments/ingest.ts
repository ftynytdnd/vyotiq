/**
 * External attachment ingest — copies files into app userData under
 * `attachments/{workspaceId}/{conversationId}/{messageId}/` under `<userData>/vyotiq/attachments/`.
 */

import { copyFile, mkdir, stat, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { PromptAttachmentMeta } from '@shared/types/chat.js';
import {
  MAX_CHAT_ATTACHMENTS
} from '@shared/constants.js';
import { guessMimeFromName, mediaKindFromMeta } from '@shared/attachments/mediaKind.js';
import {
  formatAttachmentSizeLimitError,
  maxBytesForAttachment
} from '@shared/attachments/attachmentSizeLimits.js';
import { formatAttachmentErrorReason } from '@shared/attachments/formatAttachmentError.js';

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
  let st;
  try {
    st = await stat(input.sourcePath);
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === 'ENOENT') {
      throw new Error(formatAttachmentErrorReason('ENOENT: no such file'));
    }
    throw err;
  }
  if (!st.isFile()) {
    throw new Error(formatAttachmentErrorReason('Not a file'));
  }

  const name = basename(input.sourcePath);
  const mimeType = guessMimeFromName(name);
  const mediaKind = mediaKindFromMeta({ name, mimeType });
  const sizeCap = maxBytesForAttachment({ name, mimeType });
  if (st.size > sizeCap) {
    throw new Error(formatAttachmentSizeLimitError(name, sizeCap));
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

export interface IngestFileBatchContext {
  workspaceId: string;
  conversationId: string;
  messageId: string;
}

export interface IngestFileBatchResult {
  ingested: PromptAttachmentMeta[];
  rejected: Array<{ name: string; reason: string }>;
}

/** Ingest many paths; oversize / invalid files are skipped instead of failing the batch. */
export async function ingestExternalFiles(
  paths: string[],
  ctx: IngestFileBatchContext
): Promise<IngestFileBatchResult> {
  const ingested: PromptAttachmentMeta[] = [];
  const rejected: Array<{ name: string; reason: string }> = [];
  for (const sourcePath of paths) {
    const name = basename(sourcePath);
    try {
      ingested.push(
        await ingestExternalFile({
          sourcePath,
          ...ctx
        })
      );
    } catch (err: unknown) {
      const reason = err instanceof Error ? err.message : String(err);
      rejected.push({ name, reason });
    }
  }
  return { ingested, rejected };
}

export function assertAttachmentCount(count: number): void {
  if (count > MAX_CHAT_ATTACHMENTS) {
    throw new Error(`Maximum ${MAX_CHAT_ATTACHMENTS} attachments per message`);
  }
}

export interface IngestBufferInput {
  buffer: Buffer;
  suggestedName: string;
  mimeType: string;
  workspaceId: string;
  conversationId: string;
  messageId: string;
}

/** Write in-memory bytes into the conversation attachment store. */
export async function ingestBuffer(input: IngestBufferInput): Promise<PromptAttachmentMeta> {
  const name = input.suggestedName.replace(/[^\w.\-()+ ]/g, '_').slice(0, 180) || 'file';
  const mimeType = input.mimeType;
  const mediaKind = mediaKindFromMeta({ name, mimeType });
  const sizeCap = maxBytesForAttachment({ name, mimeType });
  if (input.buffer.length > sizeCap) {
    throw new Error(formatAttachmentSizeLimitError(name, sizeCap));
  }

  const dir = messageDir(input.workspaceId, input.conversationId, input.messageId);
  await mkdir(dir, { recursive: true });
  const dest = join(dir, `${randomUUID().slice(0, 8)}-${name}`);
  await writeFile(dest, input.buffer);

  return {
    id: randomUUID(),
    name,
    mimeType,
    mediaKind,
    sizeBytes: input.buffer.length,
    storedPath: dest,
    external: true
  };
}
