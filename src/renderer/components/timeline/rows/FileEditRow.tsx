/**
 * Checkpointed file-edit row — compact change card (stats + Open).
 */

import { FileChangeCard } from '../../diff/FileChangeCard.js';
import { openWorkspaceFile } from '../../../lib/openPath.js';
import { useWorkspaceStore } from '../../../store/useWorkspaceStore.js';

interface FileEditRowProps {
  filePath: string;
  additions: number;
  deletions: number;
}

export function FileEditRow({ filePath, additions, deletions }: FileEditRowProps) {
  const workspaceId = useWorkspaceStore((s) => s.activeId);

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
    />
  );
}
