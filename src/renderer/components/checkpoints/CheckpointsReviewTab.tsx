/**

 * Checkpoints Review tab — read-only diff viewer for pending changes.

 */



import { useEffect, useMemo, useState } from 'react';

import type { PendingChange } from '@shared/types/checkpoint.js';

import { useChatStore } from '../../store/useChatStore.js';

import { usePendingChanges } from '../../store/useCheckpointsStore.js';

import { chromeListEmptyClassName, chromeInsetNoteClassName } from '../ui/SurfaceShell.js';

import { cn } from '../../lib/cn.js';

import { fileGroupKey, groupByFilePath } from './pending/groupPendingByPath.js';

import { ReviewDiffViewer } from './review/ReviewDiffViewer.js';



export function CheckpointsReviewTab() {

  const conversationId = useChatStore((s) => s.conversationId);

  const pending = usePendingChanges(conversationId);

  const fileGroups = useMemo(() => groupByFilePath(pending), [pending]);

  const [activeKey, setActiveKey] = useState<string | null>(null);



  useEffect(() => {

    if (fileGroups.length === 0) {

      setActiveKey(null);

      return;

    }

    setActiveKey((cur) => {

      if (cur && fileGroups.some((g) => fileGroupKey(g.workspaceId, g.filePath) === cur)) {

        return cur;

      }

      const first = fileGroups[0];

      return first ? fileGroupKey(first.workspaceId, first.filePath) : null;

    });

  }, [fileGroups]);



  const activeGroup = useMemo(() => {

    if (!activeKey) return fileGroups[0];

    return fileGroups.find((g) => fileGroupKey(g.workspaceId, g.filePath) === activeKey) ?? fileGroups[0];

  }, [activeKey, fileGroups]);



  const headChange: PendingChange | undefined = activeGroup?.entries[activeGroup.entries.length - 1];



  if (!conversationId) {

    return (

      <div className={chromeListEmptyClassName}>Select a conversation to review pending changes.</div>

    );

  }



  if (fileGroups.length === 0) {

    return (

      <div className={chromeListEmptyClassName}>No pending changes in this conversation.</div>

    );

  }



  return (

    <div className="flex min-h-0 flex-1 flex-col gap-2">

      <div className={cn(chromeInsetNoteClassName, 'text-meta text-text-muted')}>

        {pending.length} pending change{pending.length === 1 ? '' : 's'} — read-only diffs. Accept or

        reject from the timeline pending row.

      </div>

      <ul className="scrollbar-stealth vx-memory-list max-h-32 shrink-0 overflow-y-auto">

        {fileGroups.map((g) => {

          const key = fileGroupKey(g.workspaceId, g.filePath);

          return (

            <li key={key}>

              <button

                type="button"

                className="vx-memory-list-item w-full text-left font-mono text-row"

                data-active={key === activeKey ? 'true' : 'false'}

                onClick={() => setActiveKey(key)}

              >

                {g.filePath}

              </button>

            </li>

          );

        })}

      </ul>

      {headChange && <ReviewDiffViewer change={headChange} />}

    </div>

  );

}

