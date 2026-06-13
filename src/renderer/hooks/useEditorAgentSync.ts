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
  if (store.content !== store.savedContent) {
    store.markStaleOnDisk();
    return;
  }
  try {
    const result = await vyotiq.editor.read({
      path: filePath,
      ...(workspaceId ? { workspaceId } : {})
    });
    store.applyExternalContent(result.content, result.mtimeMs);
  } catch {
    store.markStaleOnDisk();
  }
}

export function useEditorAgentSync(): void {
  useEffect(() => {
    const unsub = vyotiq.chat.onEvent((_runId, event) => {
      const { open, filePath, workspaceId } = useEditorStore.getState();
      if (!open || !filePath) return;
      if (!eventTouchesPath(event, filePath)) return;

      if (event.kind === 'diff-stream' && !event.settled) {
        return;
      }

      void refreshEditorFromDisk(filePath, workspaceId);
    });
    return unsub;
  }, []);
}
