/**
 * Pre-parse healing for live assistant markdown (remend + open fence close).
 */

import remend from 'remend';

const REMEND_OPTIONS = {
  bold: true,
  italic: true,
  boldItalic: true,
  inlineCode: true,
  links: true,
  linkMode: 'text-only' as const,
  strikethrough: true,
  images: true
};

/** Close a trailing unterminated fenced code block for render-only parsing. */
function closeOpenFence(text: string): string {
  const lines = text.split('\n');
  let fenceCount = 0;
  for (const line of lines) {
    if (line.trimStart().startsWith('```')) fenceCount++;
  }
  if (fenceCount % 2 === 1) {
    return `${text}\n\`\`\``;
  }
  return text;
}

export function healStreamingMarkdown(text: string): string {
  return remend(closeOpenFence(text), REMEND_OPTIONS);
}
