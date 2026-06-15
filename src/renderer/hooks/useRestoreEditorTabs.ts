/**
 * Restore persisted editor tabs when the active workspace changes.
 */

import { useEffect, useRef } from 'react';
import { useWorkspaceStore } from '../store/useWorkspaceStore.js';
import { useEditorStore } from '../store/useEditorStore.js';
import { readPersistedEditorTabs } from '../lib/editorTabsPersistence.js';
import { useToastStore } from '../store/useToastStore.js';
import { basenameFromPath } from '@shared/text/languageFromPath.js';

export function useRestoreEditorTabs(): void {
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeId);
  const restoredRef = useRef(new Set<string>());

  useEffect(() => {
    if (!activeWorkspaceId) return;
    if (restoredRef.current.has(activeWorkspaceId)) return;
    restoredRef.current.add(activeWorkspaceId);

    const persisted = readPersistedEditorTabs(activeWorkspaceId);
    if (persisted.length === 0) return;

    const { openFile, setActiveTab } = useEditorStore.getState();
    void (async () => {
      for (const entry of persisted) {
        try {
          await openFile(entry.filePath, { workspaceId: activeWorkspaceId });
        } catch {
          useToastStore
            .getState()
            .show(`Could not restore ${basenameFromPath(entry.filePath)}`, 'danger');
        }
      }
      const active = persisted.find((t) => t.active)?.filePath ?? persisted[0]?.filePath;
      if (active) setActiveTab(active);
    })();
  }, [activeWorkspaceId]);
}
