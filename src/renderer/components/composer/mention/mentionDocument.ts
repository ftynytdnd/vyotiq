/**
 * Structured composer document for inline `@` file mentions.
 * Draft persistence uses {@link serializeMentionDocument} when mentions exist.
 */

import type { MentionRef } from '@shared/types/mention.js';
import { randomId } from '../../../lib/ids.js';

export type MentionSegment =
  | { type: 'text'; value: string }
  | { type: 'mention'; ref: MentionRef };

export interface MentionDocument {
  segments: MentionSegment[];
}

const DRAFT_PREFIX = '\uFEFFvy-mention:v1:';

export function emptyMentionDocument(): MentionDocument {
  return { segments: [{ type: 'text', value: '' }] };
}

export function mentionDocumentFromText(text: string): MentionDocument {
  if (!text) return emptyMentionDocument();
  return { segments: [{ type: 'text', value: text }] };
}

/** Plain prompt text: mention chips become `@label` inline. */
export function documentToPlainText(doc: MentionDocument): string {
  return doc.segments
    .map((s) => (s.type === 'text' ? s.value : `@${s.ref.label}`))
    .join('');
}

export function documentTrimmedPlain(doc: MentionDocument): string {
  return documentToPlainText(doc).trim();
}

export function extractMentions(doc: MentionDocument): MentionRef[] {
  const out: MentionRef[] = [];
  for (const s of doc.segments) {
    if (s.type === 'mention') out.push(s.ref);
  }
  return out;
}

export function hasComposerContent(doc: MentionDocument): boolean {
  return documentTrimmedPlain(doc).length > 0 || extractMentions(doc).length > 0;
}

export function serializeMentionDocument(doc: MentionDocument): string {
  const mentions = extractMentions(doc);
  if (mentions.length === 0) return documentToPlainText(doc);
  return DRAFT_PREFIX + JSON.stringify(doc);
}

export function parseMentionDocument(raw: string): MentionDocument {
  if (!raw.startsWith(DRAFT_PREFIX)) {
    return mentionDocumentFromText(raw);
  }
  try {
    const parsed = JSON.parse(raw.slice(DRAFT_PREFIX.length)) as MentionDocument;
    if (!parsed?.segments || !Array.isArray(parsed.segments)) {
      return mentionDocumentFromText(raw);
    }
    return normalizeDocument(parsed);
  } catch {
    return mentionDocumentFromText(raw);
  }
}

function normalizeDocument(doc: MentionDocument): MentionDocument {
  const segments: MentionSegment[] = [];
  for (const s of doc.segments) {
    if (s.type === 'text' && typeof s.value === 'string') {
      if (s.value.length > 0 || segments.length === 0) segments.push(s);
    } else if (s.type === 'mention' && s.ref?.id && s.ref.label) {
      segments.push(s);
    }
  }
  if (segments.length === 0) return emptyMentionDocument();
  return { segments };
}

export function createFileMentionRef(path: string, partial?: Partial<MentionRef>): MentionRef {
  return {
    kind: 'file',
    id: partial?.id ?? randomId(),
    label: path,
    workspacePath: path,
    ...partial
  };
}

/** Insert a file mention chip at `caretPlainOffset` in the plain-text coordinate space. */
export function insertFileMentionAt(
  doc: MentionDocument,
  caretPlainOffset: number,
  path: string,
  ref?: Partial<MentionRef>
): MentionDocument {
  const plain = documentToPlainText(doc);
  const before = plain.slice(0, caretPlainOffset);
  const after = plain.slice(caretPlainOffset);
  const mention: MentionSegment = {
    type: 'mention',
    ref: createFileMentionRef(path, ref)
  };
  return mentionDocumentFromPlainSplit(before, mention, after);
}

/** Replace the active `@token` (if any) ending at `caretPlainOffset`. */
export function replaceAtTokenWithMention(
  doc: MentionDocument,
  tokenStart: number,
  caretPlainOffset: number,
  path: string,
  ref?: Partial<MentionRef>
): MentionDocument {
  const plain = documentToPlainText(doc);
  const before = plain.slice(0, tokenStart);
  const after = plain.slice(caretPlainOffset);
  const mention: MentionSegment = {
    type: 'mention',
    ref: createFileMentionRef(path, ref)
  };
  const mergedBefore = before.endsWith('@') ? before.slice(0, -1) : before;
  return mentionDocumentFromPlainSplit(mergedBefore, mention, after);
}

function mentionDocumentFromPlainSplit(
  before: string,
  mention: MentionSegment,
  after: string
): MentionDocument {
  const segments: MentionSegment[] = [];
  if (before.length > 0) segments.push({ type: 'text', value: before });
  segments.push(mention);
  if (after.length > 0) segments.push({ type: 'text', value: after });
  if (segments.length === 0) return emptyMentionDocument();
  return { segments };
}
