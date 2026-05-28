/**
 * Cheap one-pass highlight.js tint for streaming fenced code blocks.
 * Bounded to keep cost linear during live token streams.
 */

import hljs from 'highlight.js';

const MAX_HIGHLIGHT_LINES = 200;

export interface StreamHighlightResult {
  html: string;
  language: string;
}

/** Highlight when the fence language is registered; otherwise plain text. */
export function highlightStreamingCode(
  language: string | undefined,
  content: string
): StreamHighlightResult | null {
  if (!language || content.trim().length === 0) return null;
  if (!hljs.getLanguage(language)) return null;

  const lines = content.split('\n');
  const bounded =
    lines.length > MAX_HIGHLIGHT_LINES
      ? lines.slice(0, MAX_HIGHLIGHT_LINES).join('\n')
      : content;

  try {
    const { value } = hljs.highlight(bounded, { language, ignoreIllegals: true });
    return { html: value, language };
  } catch {
    return null;
  }
}
