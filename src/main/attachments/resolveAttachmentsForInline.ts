/**
 * Bridge `PromptAttachmentMeta` (composer + timeline wire) to the same
 * `<file path="…">…</file>` blocks `inlineFiles` emits for legacy
 * workspace-relative path arrays.
 */

import { readFile } from 'node:fs/promises';
import type { AttachmentMediaKind, PromptAttachmentMeta } from '@shared/types/chat.js';
import { mediaKindFromMeta } from '@shared/attachments/mediaKind.js';
import { escapeXmlAttr } from '../orchestrator/envelope/index.js';
import {
  inlineFiles,
  type InlineFileCache
} from '../orchestrator/contextManager.js';
import { realpathInsideAttachmentsRoot } from './sandbox.js';

const INLINE_FILE_CHAR_CAP = 32_000;
const INLINE_ABORTED_MARKER = '(aborted before read)';

function attachmentMediaKind(meta: PromptAttachmentMeta): AttachmentMediaKind {
  return meta.mediaKind ?? mediaKindFromMeta(meta);
}

function attachmentPathKey(meta: PromptAttachmentMeta): string {
  return meta.workspacePath ?? meta.storedPath ?? meta.id;
}

function isBinaryMediaKind(kind: AttachmentMediaKind): boolean {
  return kind === 'image' || kind === 'pdf' || kind === 'video' || kind === 'audio';
}

const MEDIA_REFERENCE_NOTES: Record<'image' | 'pdf' | 'video' | 'audio', string> = {
  image:
    'Reference only — image bytes are not inlined. The user sees a thumbnail in Vyotiq; you receive path and metadata.',
  pdf:
    'Reference only — PDF bytes are not inlined. Native PDF may be on the wire when the model supports file input.',
  video:
    'Reference only — video bytes are not inlined. Native video may be on the wire when the model supports video input.',
  audio:
    'Reference only — audio bytes are not inlined. Native audio may be on the wire when the model supports audio input.'
};

function mediaReferenceBlock(
  meta: PromptAttachmentMeta,
  kind: 'image' | 'pdf' | 'video' | 'audio'
): string {
  const displayPath = meta.workspacePath ?? meta.name;
  const safePath = escapeXmlAttr(displayPath);
  const attrs = [`path="${safePath}"`, `kind="${kind}-reference"`];
  if (meta.mimeType) attrs.push(`mime="${escapeXmlAttr(meta.mimeType)}"`);
  if (meta.sizeBytes !== undefined) attrs.push(`size="${String(meta.sizeBytes)}"`);
  attrs.push(`note="${escapeXmlAttr(MEDIA_REFERENCE_NOTES[kind])}"`);
  return `<file ${attrs.join(' ')} />`;
}

function shouldSkipForVisionPrepared(
  meta: PromptAttachmentMeta,
  skipVisionPreparedPaths?: ReadonlySet<string>
): boolean {
  if (!skipVisionPreparedPaths || skipVisionPreparedPaths.size === 0) return false;
  const key = attachmentPathKey(meta);
  return skipVisionPreparedPaths.has(key);
}

function buildInlineTruncationMarker(shownChars: number, totalChars: number): string {
  return (
    `\n<!-- TRUNCATED: file exceeds the inline cap. shown=${shownChars} chars / total=${totalChars} chars. ` +
    'Call `read` with a specific line range if you need the rest. -->'
  );
}

async function inlineExternalOne(
  meta: PromptAttachmentMeta,
  signal?: AbortSignal
): Promise<string> {
  const kind = attachmentMediaKind(meta);
  if (kind === 'image') return mediaReferenceBlock(meta, 'image');
  if (kind === 'pdf') return mediaReferenceBlock(meta, 'pdf');
  if (kind === 'video') return mediaReferenceBlock(meta, 'video');
  if (kind === 'audio') return mediaReferenceBlock(meta, 'audio');
  const displayPath = meta.workspacePath ?? meta.name;
  const safePath = escapeXmlAttr(displayPath);
  if (signal?.aborted) {
    return `<file path="${safePath}" error="${INLINE_ABORTED_MARKER}" />`;
  }
  if (!meta.storedPath) {
    return `<file path="${safePath}" error="missing storedPath" />`;
  }
  let abs: string;
  try {
    abs = await realpathInsideAttachmentsRoot(meta.storedPath);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return `<file path="${safePath}" error="${escapeXmlAttr(msg)}" />`;
  }
  if (signal?.aborted) {
    return `<file path="${safePath}" error="${INLINE_ABORTED_MARKER}" />`;
  }
  try {
    const txt = await readFile(abs, { encoding: 'utf8', signal });
    const body =
      txt.length > INLINE_FILE_CHAR_CAP
        ? txt.slice(0, INLINE_FILE_CHAR_CAP) +
          buildInlineTruncationMarker(INLINE_FILE_CHAR_CAP, txt.length)
        : txt;
    return `<file path="${safePath}">\n${body}\n</file>`;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException)?.name === 'AbortError') {
      return `<file path="${safePath}" error="${INLINE_ABORTED_MARKER}" />`;
    }
    const msg = err instanceof Error ? err.message : String(err);
    return `<file path="${safePath}" error="${escapeXmlAttr(msg)}" />`;
  }
}

async function inlineExternalAttachments(
  items: PromptAttachmentMeta[],
  signal?: AbortSignal
): Promise<string> {
  if (items.length === 0) return '';
  const parts = await Promise.all(items.map((meta) => inlineExternalOne(meta, signal)));
  return parts.join('\n\n');
}

export interface ResolveAttachmentsInput {
  attachmentMeta?: PromptAttachmentMeta[];
  /** Legacy workspace-relative paths when `attachmentMeta` is absent. */
  legacyAttachments?: string[];
  workspacePath: string;
  cache?: InlineFileCache;
  signal?: AbortSignal;
  /** Workspace/stored paths already sent as native vision parts — omit from XML. */
  skipVisionPreparedPaths?: ReadonlySet<string>;
}

/**
 * Produce the inner `<file …>` block content for the user turn envelope.
 * Prefers `attachmentMeta`; falls back to legacy `attachments` string[].
 */
export async function resolveAttachmentsForInline(
  input: ResolveAttachmentsInput
): Promise<string> {
  const { attachmentMeta, legacyAttachments, workspacePath, cache, signal, skipVisionPreparedPaths } =
    input;

  if (attachmentMeta && attachmentMeta.length > 0) {
    const workspaceTextPaths: string[] = [];
    const workspaceMediaRefs: PromptAttachmentMeta[] = [];
    const external: PromptAttachmentMeta[] = [];
    for (const meta of attachmentMeta) {
      if (shouldSkipForVisionPrepared(meta, skipVisionPreparedPaths)) continue;
      if (meta.workspacePath) {
        const kind = attachmentMediaKind(meta);
        if (isBinaryMediaKind(kind)) {
          workspaceMediaRefs.push(meta);
        } else {
          workspaceTextPaths.push(meta.workspacePath);
        }
      } else if (meta.storedPath) {
        external.push(meta);
      }
    }
    const parts: string[] = [];
    if (workspaceTextPaths.length > 0) {
      parts.push(await inlineFiles(workspacePath, workspaceTextPaths, cache, signal));
    }
    if (workspaceMediaRefs.length > 0) {
      parts.push(
        workspaceMediaRefs
          .map((meta) => {
            const kind = attachmentMediaKind(meta);
            if (kind === 'image') return mediaReferenceBlock(meta, 'image');
            if (kind === 'pdf') return mediaReferenceBlock(meta, 'pdf');
            if (kind === 'video') return mediaReferenceBlock(meta, 'video');
            if (kind === 'audio') return mediaReferenceBlock(meta, 'audio');
            return '';
          })
          .filter((block) => block.length > 0)
          .join('\n\n')
      );
    }
    if (external.length > 0) {
      parts.push(await inlineExternalAttachments(external, signal));
    }
    return parts.filter((p) => p.length > 0).join('\n\n');
  }

  if (legacyAttachments && legacyAttachments.length > 0) {
    return inlineFiles(workspacePath, legacyAttachments, cache, signal);
  }

  return '';
}
