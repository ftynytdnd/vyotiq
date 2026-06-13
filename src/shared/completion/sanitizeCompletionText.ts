/**
 * Normalize provider completion output for ghost-text insertion.
 */

import type { CompletionKind } from '../types/completion.js';

const MAX_EDITOR_CHARS = 800;
const MAX_COMPOSER_CHARS = 240;

/** Strip fences / chatter; cap length per surface. */
export function sanitizeCompletionText(raw: string, kind: CompletionKind): string {
  let text = raw.replace(/\r\n/g, '\n').trim();
  if (!text) return '';

  if (text.startsWith('```')) {
    const lines = text.split('\n');
    if (lines.length >= 2) {
      lines.shift();
      const last = lines[lines.length - 1];
      if (last?.trim().startsWith('```')) lines.pop();
      text = lines.join('\n');
    }
  }

  if (kind === 'composer') {
    const para = text.indexOf('\n\n');
    if (para >= 0) text = text.slice(0, para);
    const nl = text.indexOf('\n');
    if (nl >= 0) {
      const first = text.slice(0, nl).trimEnd();
      if (first.length >= 12) text = first;
    }
    text = text.trim();
  }

  const max = kind === 'editor' ? MAX_EDITOR_CHARS : MAX_COMPOSER_CHARS;
  if (text.length > max) text = text.slice(0, max);
  return text;
}
