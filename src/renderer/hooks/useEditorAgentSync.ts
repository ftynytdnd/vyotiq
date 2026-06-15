/**
 * Sync open editor buffer with agent file-edit / diff-stream events.
 */

import { useEffect } from 'react';
import type { TimelineEvent } from '@shared/types/chat.js';
import { normalizePath } from '../lib/normalizePath.js';
import { vyotiq } from '../lib/ipc.js';
import { useEditorStore } from '../store/useEditorStore.js';

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

export function useEditorAgentSync(): void {
  useEffect(() => {
    const unsub = vyotiq.chat.onEvent((_runId, event) => {
      const { open, tabs, refreshTabFromDisk, applyExternalContent, setAgentStreaming } =
        useEditorStore.getState();
      if (!open || tabs.length === 0) return;
      for (const tab of tabs) {
        if (!eventTouchesPath(event, tab.filePath)) continue;
        if (event.kind === 'diff-stream' && !event.settled) {
          if (event.postBody !== undefined) {
            applyExternalContent(tab.filePath, event.postBody);
            setAgentStreaming(tab.filePath, true);
          }
          continue;
        }
        setAgentStreaming(tab.filePath, false);
        void refreshTabFromDisk(tab.filePath, { force: true });
      }
    });
    return unsub;
  }, []);
}
