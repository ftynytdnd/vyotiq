/**
 * Bridge `MentionRef` file mentions to the same `<file path="…">` blocks
 * `resolveAttachmentsForInline` emits for attachment metadata.
 */

import type { MentionRef } from '@shared/types/mention.js';
import type { PromptAttachmentMeta } from '@shared/types/chat.js';
import { resolveAttachmentsForInline, type ResolveAttachmentsInput } from './resolveAttachmentsForInline.js';

function mentionToAttachmentMeta(ref: MentionRef): PromptAttachmentMeta | null {
  if (ref.kind !== 'file') return null;
  return {
    id: ref.id,
    name: ref.label,
    ...(ref.workspacePath ? { workspacePath: ref.workspacePath } : {}),
    ...(ref.storedPath ? { storedPath: ref.storedPath } : {}),
    ...(ref.mimeType ? { mimeType: ref.mimeType } : {}),
    ...(ref.sizeBytes !== undefined ? { sizeBytes: ref.sizeBytes } : {}),
    ...(ref.external ? { external: true } : {})
  };
}

export interface ResolveMentionsInput {
  mentions?: MentionRef[];
  workspacePath: string;
  cache?: ResolveAttachmentsInput['cache'];
  signal?: AbortSignal;
}

/**
 * Produce inline `<file …>` blocks for file mentions on the user turn.
 */
export async function resolveMentionsForInline(input: ResolveMentionsInput): Promise<string> {
  const { mentions, workspacePath, cache, signal } = input;
  if (!mentions || mentions.length === 0) return '';

  const attachmentMeta = mentions
    .map(mentionToAttachmentMeta)
    .filter((m): m is PromptAttachmentMeta => m !== null);

  if (attachmentMeta.length === 0) return '';

  return resolveAttachmentsForInline({
    attachmentMeta,
    workspacePath,
    cache,
    signal
  });
}
