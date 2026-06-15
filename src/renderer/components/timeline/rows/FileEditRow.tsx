/**
 * Checkpointed file-edit row — change card with optional diff body.
 */

import { useState } from 'react';
import type { DiffHunk } from '@shared/types/tool.js';
import { FileChangeCard } from '../../diff/FileChangeCard.js';
import { SnippetDiffBody } from '../../diff/SnippetDiffBody.js';
import { openWorkspaceFile } from '../../../lib/openPath.js';
import { useWorkspaceStore } from '../../../store/useWorkspaceStore.js';

interface FileEditRowProps {
  filePath: string;
  additions: number;
  deletions: number;
  hunks?: DiffHunk[];
}

export function FileEditRow({ filePath, additions, deletions, hunks }: FileEditRowProps) {
  const workspaceId = useWorkspaceStore((s) => s.activeId);
  const [expanded, setExpanded] = useState(Boolean(hunks?.length));

  return (
    <FileChangeCard
      filePath={filePath}
      additions={additions}
      deletions={deletions}
      variant="authoritative"
      onOpen={() => {
        void openWorkspaceFile(filePath, {
          ...(workspaceId ? { workspaceId } : {}),
          context: 'file-edit'
        });
      }}
    >
      {hunks && hunks.length > 0 ? (
        <div className="flex flex-col gap-1">
          <button
            type="button"
            className="self-start font-mono text-meta text-text-faint hover:text-text-secondary"
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? 'Hide diff' : 'Show diff'}
          </button>
          {expanded ? (
            <SnippetDiffBody hunks={hunks} variant="authoritative" filePath={filePath} />
          ) : null}
        </div>
      ) : null}
    </FileChangeCard>
  );
}
