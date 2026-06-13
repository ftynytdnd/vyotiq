/**
 * Highlight `@path` spans in sent user prompts (mentions + literal tokens).
 */

import type { ReactNode } from 'react';
import type { MentionRef } from '@shared/types/mention.js';
import { isEditableTextFile } from '@shared/text/isEditableTextFile.js';
import { openWorkspaceFileInEditor } from '../../../lib/openWorkspaceFileInEditor.js';
import { useWorkspaceStore } from '../../../store/useWorkspaceStore.js';

const PATH_LIKE = /@[\w./\\-]+/g;

function mentionForToken(mentions: MentionRef[], token: string): MentionRef | undefined {
  const label = token.slice(1);
  return mentions.find((m) => m.label === label || `@${m.label}` === token);
}

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
    const mention = mentionForToken(mentions, token);
    const path = mention?.workspacePath ?? mention?.label;
    const openable =
      mention?.kind === 'file' &&
      typeof path === 'string' &&
      path.length > 0 &&
      isEditableTextFile(path);

    parts.push(
      emphasized ? (
        openable ? (
          <button
            key={`${start}-${token}`}
            type="button"
            className="vx-mention-highlight vx-mention-highlight--open"
            onClick={() => {
              const workspaceId = useWorkspaceStore.getState().activeId ?? undefined;
              void openWorkspaceFileInEditor(path, { workspaceId });
            }}
            title={`Open ${path}`}
          >
            {token}
          </button>
        ) : (
          <span key={`${start}-${token}`} className="vx-mention-highlight">
            {token}
          </span>
        )
      ) : (
        token
      )
    );
    last = start + token.length;
  }
  if (last < content.length) parts.push(content.slice(last));
  return parts.length > 0 ? parts : [content];
}
