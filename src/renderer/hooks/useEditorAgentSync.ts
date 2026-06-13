/**
 * Sync open editor buffer with agent file-edit / diff-stream events.
 */

import { useEffect } from 'react';
import type { TimelineEvent } from '@shared/types/chat.js';
import { vyotiq } from '../lib/ipc.js';
import { editorMatchesPath, useEditorStore } from '../store/useEditorStore.js';

function normalizePath(p: string): string {
  return p.replace(/\\/g, '/');
}

function eventTouchesPath(event: TimelineEvent, filePath: string): boolean {
  const target = normalizePath(filePath);
  if (event.kind === 'file-edit' && normalizePath(event.filePath) === target) {
    return true;
  }
  if (event.kind === 'diff-stream' && normalizePath(event.filePath) === target) {
    return true;
  }
  return false;
}

async function refreshEditorFromDisk(filePath: string, workspaceId: string | null): Promise<void> {
  const store = useEditorStore.getState();
  if (!editorMatchesPath(store, filePath)) return;
  const tab = store.tabs.find((t) => normalizePath(t.filePath) === normalizePath(filePath));
  if (!tab) return;
  if (tab.content !== tab.savedContent) {
    store.markStaleOnDisk(filePath);
    return;
  }
  try {
    const result = await vyotiq.editor.read({
      path: filePath,
      ...(workspaceId ? { workspaceId } : {})
    });
    store.applyExternalContent(filePath, result.content, result.mtimeMs);
  } catch {
    store.markStaleOnDisk(filePath);
  }
}

export function useEditorAgentSync(): void {
  useEffect(() => {
    const unsub = vyotiq.chat.onEvent((_runId, event) => {
      const { open, tabs, workspaceId } = useEditorStore.getState();
      if (!open || tabs.length === 0) return;
      for (const tab of tabs) {
        if (!eventTouchesPath(event, tab.filePath)) continue;
        if (event.kind === 'diff-stream' && !event.settled) continue;
        void refreshEditorFromDisk(tab.filePath, tab.workspaceId ?? workspaceId);
      }
    });
    return unsub;
  }, []);
}
