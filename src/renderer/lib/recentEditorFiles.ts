/**
 * Per-workspace recent editor paths — persisted in settings.ui.
 */

import { vyotiq } from './ipc.js';
import { useSettingsStore } from '../store/useSettingsStore.js';

const MAX_RECENT = 8;

export function readRecentEditorFiles(workspaceId: string | null): string[] {
  if (!workspaceId) return [];
  const map = useSettingsStore.getState().settings.ui?.recentEditorFilesByWorkspace ?? {};
  return map[workspaceId] ?? [];
}

export function pushRecentEditorFile(workspaceId: string | null, filePath: string): void {
  if (!workspaceId || filePath.trim().length === 0) return;
  const settings = useSettingsStore.getState().settings;
  const prev = settings.ui?.recentEditorFilesByWorkspace ?? {};
  const list = prev[workspaceId] ?? [];
  const next = [filePath, ...list.filter((p) => p !== filePath)].slice(0, MAX_RECENT);
  void vyotiq.settings.set({
    ui: {
      recentEditorFilesByWorkspace: { ...prev, [workspaceId]: next }
    }
  });
  useSettingsStore.setState({
    settings: {
      ...settings,
      ui: {
        ...settings.ui,
        recentEditorFilesByWorkspace: { ...prev, [workspaceId]: next }
      }
    }
  });
}
