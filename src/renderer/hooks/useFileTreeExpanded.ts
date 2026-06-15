/**
 * Per-workspace expanded folder paths — persisted in settings.
 */

import { useCallback, useMemo } from 'react';
import { useSettingsStore } from '../store/useSettingsStore.js';
import { vyotiq } from '../lib/ipc.js';

const PERSIST_DEBOUNCE_MS = 400;
const persistTimers = new Map<string, ReturnType<typeof setTimeout>>();

function flushExpanded(workspaceId: string, paths: string[]): void {
  const settings = useSettingsStore.getState().settings;
  const prev = settings.ui?.fileTreeExpandedByWorkspace ?? {};
  void vyotiq.settings
    .set({
      ui: {
        fileTreeExpandedByWorkspace: { ...prev, [workspaceId]: paths }
      }
    })
    .catch(() => {
      /* best-effort */
    });
}

function schedulePersist(workspaceId: string, paths: string[]): void {
  const prev = persistTimers.get(workspaceId);
  if (prev !== undefined) clearTimeout(prev);
  persistTimers.set(
    workspaceId,
    setTimeout(() => {
      persistTimers.delete(workspaceId);
      flushExpanded(workspaceId, paths);
    }, PERSIST_DEBOUNCE_MS)
  );
}

/** Cancel pending disk flush when a workspace is removed from the registry. */
export function cancelFileTreeExpandedPersist(workspaceId: string): void {
  const prev = persistTimers.get(workspaceId);
  if (prev !== undefined) {
    clearTimeout(prev);
    persistTimers.delete(workspaceId);
  }
}

export function useFileTreeExpanded(workspaceId: string | null) {
  const settings = useSettingsStore((s) => s.settings);

  const expandedPaths = useMemo(() => {
    if (!workspaceId) return [] as string[];
    return settings.ui?.fileTreeExpandedByWorkspace?.[workspaceId] ?? [];
  }, [workspaceId, settings.ui?.fileTreeExpandedByWorkspace]);

  const expandedSet = useMemo(() => new Set(expandedPaths), [expandedPaths]);

  const setExpandedSet = useCallback(
    (next: Set<string>) => {
      if (!workspaceId) return;
      const paths = Array.from(next);
      useSettingsStore.setState((s) => ({
        settings: {
          ...s.settings,
          ui: {
            ...s.settings.ui,
            fileTreeExpandedByWorkspace: {
              ...s.settings.ui?.fileTreeExpandedByWorkspace,
              [workspaceId]: paths
            }
          }
        }
      }));
      schedulePersist(workspaceId, paths);
    },
    [workspaceId]
  );

  const toggleExpanded = useCallback(
    (path: string) => {
      const next = new Set(expandedSet);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      setExpandedSet(next);
    },
    [expandedSet, setExpandedSet]
  );

  const mergeExpanded = useCallback(
    (paths: string[]) => {
      if (paths.length === 0) return;
      const next = new Set(expandedSet);
      let changed = false;
      for (const p of paths) {
        if (!next.has(p)) {
          next.add(p);
          changed = true;
        }
      }
      if (changed) setExpandedSet(next);
    },
    [expandedSet, setExpandedSet]
  );

  return { expandedSet, toggleExpanded, mergeExpanded, setExpandedSet };
}
