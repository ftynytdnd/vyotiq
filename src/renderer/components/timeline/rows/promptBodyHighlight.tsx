/**
 * Highlight `@path` spans in sent user prompts (mentions + literal tokens).
 */

import type { ReactNode } from 'react';
import type { MentionRef } from '@shared/types/mention.js';

const PATH_LIKE = /@[\w./\\-]+/g;

export function renderPromptBodyContent(
  content: string,
  mentions: MentionRef[] = []
): ReactNode[] {
  const highlightSet = new Set<string>();
  for (const m of mentions) {
    if (m.label) highlightSet.add(`@${m.label}`);
  }

  const parts: ReactNode[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  const re = new RegExp(PATH_LIKE.source, 'g');
  while ((match = re.exec(content)) !== null) {
    const token = match[0];
    const start = match.index;
    if (start > last) parts.push(content.slice(last, start));
    const emphasized = highlightSet.has(token) || token.length > 2;
    parts.push(
      emphasized ? (
        <span key={`${start}-${token}`} className="vx-mention-highlight">
          {token}
        </span>
      ) : (
        token
      )
    );
    last = start + token.length;
  }
  if (last < content.length) parts.push(content.slice(last));
  return parts.length > 0 ? parts : [content];
}
