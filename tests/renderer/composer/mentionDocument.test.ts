import { describe, expect, it } from 'vitest';
import {
  documentToPlainText,
  documentTrimmedPlain,
  extractMentions,
  insertFileMentionAt,
  mentionDocumentFromText,
  parseMentionDocument,
  replaceAtTokenWithMention,
  serializeMentionDocument
} from '@renderer/components/composer/mention/mentionDocument.js';

describe('mentionDocument', () => {
  it('round-trips plain text without prefix', () => {
    const doc = mentionDocumentFromText('hello world');
    expect(serializeMentionDocument(doc)).toBe('hello world');
    expect(parseMentionDocument('hello world')).toEqual(doc);
  });

  it('serializes documents with mention chips', () => {
    const doc = insertFileMentionAt(mentionDocumentFromText('see '), 4, 'src/a.ts');
    const raw = serializeMentionDocument(doc);
    expect(raw.startsWith('\uFEFFvy-mention:v1:')).toBe(true);
    const parsed = parseMentionDocument(raw);
    expect(documentToPlainText(parsed)).toBe('see @src/a.ts');
    expect(extractMentions(parsed)).toHaveLength(1);
    expect(extractMentions(parsed)[0]?.workspacePath).toBe('src/a.ts');
  });

  it('replaces an @token with a mention chip', () => {
    const base = mentionDocumentFromText('open @src');
    const next = replaceAtTokenWithMention(base, 5, 9, 'src/main.ts');
    expect(documentToPlainText(next)).toBe('open @src/main.ts');
    expect(documentTrimmedPlain(next)).toBe('open @src/main.ts');
  });
});
