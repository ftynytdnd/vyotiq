/**
 * Soft-wrap commit message body lines at a column width (default 72).
 * Preserves subject, blank separators, and git trailer footers.
 */

import { normalizeCommitMessage } from './normalizeCommitMessage.js';

const FOOTER_LINE_RE = /^(?:BREAKING CHANGE|[A-Za-z][\w-]*):\s/;

function wrapParagraph(text: string, width: number): string {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return '';
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length <= width) {
      current = next;
      continue;
    }
    if (current) lines.push(current);
    current = word.length > width ? word.slice(0, width) : word;
  }
  if (current) lines.push(current);
  return lines.join('\n');
}

function isFooterBlock(lines: string[]): boolean {
  if (lines.length === 0) return false;
  return lines.every((l) => !l.trim() || FOOTER_LINE_RE.test(l.trim()));
}

/**
 * Wrap body paragraphs at `width` chars. Subject line and footers are left as-is.
 */
export function wrapCommitMessageBody(text: string, width = 72): string {
  const normalized = normalizeCommitMessage(text);
  if (!normalized) return '';

  const lines = normalized.split('\n');
  const subjectIdx = lines.findIndex((l) => l.trim().length > 0);
  if (subjectIdx < 0) return normalized;

  const subject = lines[subjectIdx]!.trim();
  const rest = lines.slice(subjectIdx + 1);
  if (rest.length === 0) return subject;

  let bodyStart = 0;
  if (rest[0]?.trim() === '') bodyStart = 1;

  const bodyLines = rest.slice(bodyStart);
  if (bodyLines.length === 0) {
    return `${subject}\n\n`;
  }

  const blocks: string[][] = [];
  let current: string[] = [];
  for (const line of bodyLines) {
    if (line.trim() === '') {
      if (current.length > 0) {
        blocks.push(current);
        current = [];
      }
      blocks.push([]);
      continue;
    }
    current.push(line);
  }
  if (current.length > 0) blocks.push(current);

  const wrappedBlocks: string[] = [];
  for (const block of blocks) {
    if (block.length === 0) {
      wrappedBlocks.push('');
      continue;
    }
    if (isFooterBlock(block)) {
      wrappedBlocks.push(block.join('\n'));
      continue;
    }
    const paragraph = block.join(' ').trim();
    wrappedBlocks.push(wrapParagraph(paragraph, width));
  }

  const body = wrappedBlocks.join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
  return body ? `${subject}\n\n${body}` : subject;
}
