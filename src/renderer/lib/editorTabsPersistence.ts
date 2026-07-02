/**
 * Persist open editor tabs per workspace in settings.ui.
 */

import { MAX_EDITOR_TABS } from '../store/useEditorStore.js';
import { vyotiq } from './ipc.js';
import { useSettingsStore } from '../store/useSettingsStore.js';

const PERSIST_DEBOUNCE_MS = 400;
const persistTimers = new Map<string, ReturnType<typeof setTimeout>>();

export interface PersistedEditorTab {
  filePath: string;
  active?: boolean;
}

function flushTabs(workspaceId: string, tabs: PersistedEditorTab[]): void {
  const settings = useSettingsStore.getState().settings;
  const prev = settings.ui?.editorTabsByWorkspace ?? {};
  const nextMap = { ...prev, [workspaceId]: tabs };
  void vyotiq.settings
    .set({
      ui: {
        editorTabsByWorkspace: nextMap
      }
    })
    .then((updated) => {
      useSettingsStore.setState((state) => ({
        settings: { ...state.settings, ...updated }
      }));
    })
    .catch(() => {
      /* best-effort */
    });
}

export function schedulePersistEditorTabs(
  workspaceId: string,
  tabs: PersistedEditorTab[]
): void {
  const prev = persistTimers.get(workspaceId);
  if (prev !== undefined) clearTimeout(prev);
  persistTimers.set(
    workspaceId,
    setTimeout(() => {
      persistTimers.delete(workspaceId);
      flushTabs(workspaceId, tabs.slice(0, MAX_EDITOR_TABS));
    }, PERSIST_DEBOUNCE_MS)
  );
}

export function readPersistedEditorTabs(workspaceId: string | null): PersistedEditorTab[] {
  if (!workspaceId) return [];
  const map = useSettingsStore.getState().settings.ui?.editorTabsByWorkspace ?? {};
  return map[workspaceId] ?? [];
}

export function cancelEditorTabsPersist(workspaceId: string): void {
  const prev = persistTimers.get(workspaceId);
  if (prev !== undefined) {
    clearTimeout(prev);
    persistTimers.delete(workspaceId);
  }
}
