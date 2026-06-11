/**
 * Single-line syntax highlight for diff snippet rows.
 */

import hljs from 'highlight.js';

export function highlightLineText(text: string, language: string | undefined): string {
  if (!language || !hljs.getLanguage(language) || text.length === 0) {
    return escapeHtml(text);
  }
  try {
    const { value } = hljs.highlight(text, { language, ignoreIllegals: true });
    return value;
  } catch {
    return escapeHtml(text);
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
