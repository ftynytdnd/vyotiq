/**
 * Bridge `MentionRef` mentions to inline context blocks on the user turn.
 */

import type { MentionRef } from '@shared/types/mention.js';
import type { PromptAttachmentMeta } from '@shared/types/chat.js';
import { promises as fs } from 'node:fs';
import { escapeXmlAttr } from '../orchestrator/envelope/escapeXmlBody.js';
import { wrapXml } from '../orchestrator/envelope/wrapXml.js';
import { readTranscriptTail } from '../conversations/conversationStore.js';
import { realpathInsideWorkspace } from '../tools/sandbox.js';
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

async function symbolMentionBlock(ref: MentionRef, workspacePath: string): Promise<string> {
  const filePath = ref.workspacePath;
  if (!filePath) return '';
  const line = ref.line ?? 1;
  const start = Math.max(1, line - 3);
  const end = line + 8;
  try {
    const abs = await realpathInsideWorkspace(workspacePath, filePath);
    const raw = await fs.readFile(abs, 'utf8');
    const lines = raw.split('\n');
    const slice = lines.slice(start - 1, end);
    const body = slice
      .map((text, i) => `${String(start + i).padStart(5, ' ')}\t${text}`)
      .join('\n');
    return wrapXml(
      'symbol',
      body,
      { name: ref.label, path: filePath, line: String(line) },
      { escape: true }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return `<symbol name="${escapeXmlAttr(ref.label)}" path="${escapeXmlAttr(filePath)}" error="${escapeXmlAttr(msg)}" />`;
  }
}

async function conversationMentionBlock(ref: MentionRef): Promise<string> {
  const conversationId = ref.conversationId;
  if (!conversationId) return '';
  try {
    const { events } = await readTranscriptTail(conversationId, 24);
    const lines = events
      .filter((e) => e.kind === 'user-prompt')
      .slice(-8)
      .map((e) => {
        if (e.kind === 'user-prompt') return `User: ${e.content}`;
        return '';
      })
      .filter(Boolean);
    return wrapXml(
      'conversation',
      lines.join('\n'),
      { id: conversationId, label: ref.label },
      { escape: true }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return `<conversation id="${escapeXmlAttr(conversationId)}" error="${escapeXmlAttr(msg)}" />`;
  }
}

export interface ResolveMentionsInput {
  mentions?: MentionRef[];
  workspacePath: string;
  cache?: ResolveAttachmentsInput['cache'];
  signal?: AbortSignal;
}

/**
 * Produce inline context blocks for mentions on the user turn.
 */
export async function resolveMentionsForInline(input: ResolveMentionsInput): Promise<string> {
  const { mentions, workspacePath, cache, signal } = input;
  if (!mentions || mentions.length === 0) return '';

  const blocks: string[] = [];

  const fileMentions = mentions
    .map(mentionToAttachmentMeta)
    .filter((m): m is PromptAttachmentMeta => m !== null);
  if (fileMentions.length > 0) {
    blocks.push(
      await resolveAttachmentsForInline({
        attachmentMeta: fileMentions,
        workspacePath,
        cache,
        signal
      })
    );
  }

  for (const ref of mentions) {
    if (ref.kind === 'symbol') {
      blocks.push(await symbolMentionBlock(ref, workspacePath));
    } else if (ref.kind === 'conversation') {
      blocks.push(await conversationMentionBlock(ref));
    }
  }

  return blocks.filter((b) => b.trim().length > 0).join('\n\n');
}
