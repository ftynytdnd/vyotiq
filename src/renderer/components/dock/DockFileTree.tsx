/**
 * Collapsible workspace file tree for the left dock — lazy children + virtualization.
 */

import { useCallback, useEffect, useMemo, useRef, useState, startTransition, type KeyboardEvent } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { isEditableTextFile } from '@shared/text/isEditableTextFile.js';
import { getWorkspaceTree } from '../../lib/workspaceTreeCache.js';
import { getWorkspaceChildren, invalidateWorkspaceChildrenCache } from '../../lib/workspaceChildrenCache.js';
import { openWorkspaceFileInEditor } from '../../lib/openWorkspaceFileInEditor.js';
import { previewDockWorkspaceFile } from './dockSearchFileActions.js';
import { useWorkspaceStore } from '../../store/useWorkspaceStore.js';
import { useEditorStore } from '../../store/useEditorStore.js';
import { useDockFileTreeRefreshStore } from '../../store/useDockFileTreeRefreshStore.js';
import { useFileTreeExpanded } from '../../hooks/useFileTreeExpanded.js';
import { useWorkspaceGitStatus } from '../../hooks/useWorkspaceGitStatus.js';
import { registerDockFileTreeReveal } from '../../lib/revealFileInDockTree.js';
import { vyotiq } from '../../lib/ipc.js';
import { useToastStore } from '../../store/useToastStore.js';
import { normalizePath } from '../../lib/normalizePath.js';
import {
  ancestorFolderPaths,
  buildDockFileTree,
  dockTreeRelativePath,
  DOCK_TREE_ROW_HEIGHT_PX,
  expandFoldersForFilter,
  filterDockTreePaths,
  flattenDockTreeNodes,
  flattenLazyDockTree,
  normalizeDockTreePath
} from './dockFileTreeModel.js';
import { DockFileTreeFilter } from './DockFileTreeFilter.js';
import { DockFileTreeRow } from './DockFileTreeRow.js';
import {
  DockFileTreeContextMenu,
  useDockFileTreeContextMenu
} from './DockFileTreeContextMenu.js';
import { cn } from '../../lib/cn.js';

export interface DockFileTreeProps {
  workspaceId: string | null;
}

export function DockFileTree({ workspaceId }: DockFileTreeProps) {
  const workspacePath = useWorkspaceStore((s) => {
    const entry = workspaceId ? s.list.find((w) => w.id === workspaceId) : undefined;
    return entry?.path ?? s.info.path ?? '';
  });
  const activeFilePath = useEditorStore((s) => {
    if (!s.activeFilePath || !workspaceId || !workspacePath) return null;
    const tab = s.tabs.find(
      (t) =>
        t.workspaceId === workspaceId &&
        normalizePath(t.filePath) === normalizePath(s.activeFilePath!)
    );
    return tab ? dockTreeRelativePath(tab.filePath, workspacePath) : null;
  });

  const treeRefreshVersion = useDockFileTreeRefreshStore((s) => s.version);
  const { expandedSet, toggleExpanded, mergeExpanded } = useFileTreeExpanded(workspaceId);
  const { anchorRef, target, openContextMenu, closeContextMenu } = useDockFileTreeContextMenu();

  const [filter, setFilter] = useState('');
  const [childrenByDir, setChildrenByDir] = useState<Map<string, string[]>>(() => new Map());
  const [loadingDirs, setLoadingDirs] = useState<Set<string>>(() => new Set());
  const [rootLoading, setRootLoading] = useState(false);
  const [filterPaths, setFilterPaths] = useState<string[]>([]);
  const [filterTruncated, setFilterTruncated] = useState(false);
  const [filterTotal, setFilterTotal] = useState(0);
  const [filterLoading, setFilterLoading] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(0);
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const typeaheadRef = useRef({ buffer: '', timer: null as ReturnType<typeof setTimeout> | null });

  const gitStatusMap = useWorkspaceGitStatus(workspaceId, true);

  const rowRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const scrollRef = useRef<HTMLDivElement>(null);

  const filterActive = filter.trim().length > 0;

  const loadChildren = useCallback(
    async (dirPath: string) => {
      if (!workspacePath) return;
      const normDir = dirPath.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/$/, '');
      setLoadingDirs((prev) => {
        const next = new Set(prev);
        next.add(normDir);
        return next;
      });
      try {
        const entries = await getWorkspaceChildren(workspacePath, normDir, workspaceId ?? undefined);
        setChildrenByDir((prev) => {
          const next = new Map(prev);
          next.set(normDir, entries);
          return next;
        });
      } catch {
        setChildrenByDir((prev) => {
          const next = new Map(prev);
          next.set(normDir, []);
          return next;
        });
      } finally {
        setLoadingDirs((prev) => {
          const next = new Set(prev);
          next.delete(normDir);
          return next;
        });
      }
    },
    [workspacePath, workspaceId]
  );

  const resetLazyTree = useCallback(() => {
    invalidateWorkspaceChildrenCache();
    setChildrenByDir(new Map());
    setLoadingDirs(new Set());
  }, []);

  useEffect(() => {
    if (!workspacePath || filterActive) return;
    resetLazyTree();
    let cancelled = false;
    setRootLoading(true);
    void loadChildren('').finally(() => {
      if (!cancelled) setRootLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [workspacePath, workspaceId, treeRefreshVersion, filterActive, loadChildren, resetLazyTree]);

  useEffect(() => {
    const q = filter.trim();
    if (!q || !workspacePath) {
      setFilterPaths([]);
      setFilterTruncated(false);
      setFilterTotal(0);
      return;
    }
    let cancelled = false;
    setFilterLoading(true);
    void getWorkspaceTree(workspacePath, 5, workspaceId ?? undefined)
      .then((result) => {
        if (cancelled) return;
        const filtered = filterDockTreePaths(result.entries, q);
        setFilterPaths(filtered);
        setFilterTruncated(result.truncated);
        setFilterTotal(result.total);
        mergeExpanded(expandFoldersForFilter(result.entries, q));
      })
      .catch(() => {
        if (!cancelled) {
          setFilterPaths([]);
          setFilterTruncated(false);
          setFilterTotal(0);
        }
      })
      .finally(() => {
        if (!cancelled) setFilterLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [filter, workspacePath, workspaceId, mergeExpanded]);

  const flatRows = useMemo(() => {
    if (filterActive) {
      const tree = buildDockFileTree(filterPaths);
      return flattenDockTreeNodes(tree, expandedSet);
    }
    return flattenLazyDockTree(childrenByDir, expandedSet, loadingDirs);
  }, [filterActive, filterPaths, expandedSet, childrenByDir, loadingDirs]);

  const virtualizer = useVirtualizer({
    count: flatRows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => DOCK_TREE_ROW_HEIGHT_PX,
    overscan: 8,
    getItemKey: (index) => flatRows[index]?.path ?? index
  });

  const onToggleFolder = useCallback(
    (path: string) => {
      const willExpand = !expandedSet.has(path);
      startTransition(() => {
        toggleExpanded(path);
      });
      if (willExpand && !childrenByDir.has(path)) {
        void loadChildren(path);
      }
    },
    [expandedSet, toggleExpanded, childrenByDir, loadChildren]
  );

  const revealPath = useCallback(
    (relativePath: string) => {
      const norm = normalizeDockTreePath(relativePath);
      const ancestors = ancestorFolderPaths(norm);
      mergeExpanded(ancestors);
      if (filter) setFilter('');
      for (const dir of ancestors) {
        if (!childrenByDir.has(dir)) {
          void loadChildren(dir);
        }
      }
      requestAnimationFrame(() => {
        const el = rowRefs.current.get(norm);
        el?.scrollIntoView({ block: 'nearest' });
      });
    },
    [mergeExpanded, filter, childrenByDir, loadChildren]
  );

  useEffect(() => {
    registerDockFileTreeReveal(revealPath);
    return () => registerDockFileTreeReveal(null);
  }, [revealPath]);

  useEffect(() => {
    if (!activeFilePath) return;
    const ancestors = ancestorFolderPaths(activeFilePath);
    mergeExpanded(ancestors);
    for (const dir of ancestors) {
      if (!childrenByDir.has(dir)) {
        void loadChildren(dir);
      }
    }
    requestAnimationFrame(() => {
      rowRefs.current.get(activeFilePath)?.scrollIntoView({ block: 'nearest' });
    });
  }, [activeFilePath, mergeExpanded, childrenByDir, loadChildren]);

  const onOpenFile = useCallback(
    async (path: string) => {
      if (isEditableTextFile(path)) {
        await openWorkspaceFileInEditor(path, { workspaceId: workspaceId ?? undefined });
      } else {
        await previewDockWorkspaceFile(path);
      }
      revealPath(path);
    },
    [workspaceId, revealPath]
  );

  const setRowRef = useCallback((path: string, el: HTMLButtonElement | null) => {
    if (el) rowRefs.current.set(path, el);
    else rowRefs.current.delete(path);
  }, []);

  const onRefresh = useCallback(() => {
    useDockFileTreeRefreshStore.getState().bump();
  }, []);

  const startInlineRename = useCallback((path: string) => {
    setRenamingPath(path);
    setRenameDraft(path.split('/').pop() ?? path);
  }, []);

  const cancelRename = useCallback(() => {
    setRenamingPath(null);
    setRenameDraft('');
  }, []);

  const commitRename = useCallback(async () => {
    if (!renamingPath || !workspaceId) {
      cancelRename();
      return;
    }
    const trimmed = renameDraft.trim().replace(/^[/\\]+/, '');
    if (!trimmed) {
      cancelRename();
      return;
    }
    const parent = renamingPath.includes('/')
      ? renamingPath.replace(/\/[^/]+$/, '')
      : '';
    const to = parent ? `${parent}/${trimmed}` : trimmed;
    if (to === renamingPath) {
      cancelRename();
      return;
    }
    try {
      await vyotiq.workspace.renamePath({ workspaceId, from: renamingPath, to });
      useEditorStore.getState().remapTabPath(renamingPath, to);
      onRefresh();
    } catch (err) {
      useToastStore.getState().show(err instanceof Error ? err.message : String(err), 'danger');
    }
    cancelRename();
  }, [renamingPath, renameDraft, workspaceId, onRefresh, cancelRename]);

  useEffect(() => {
    if (focusedIndex >= flatRows.length) {
      setFocusedIndex(Math.max(0, flatRows.length - 1));
    }
  }, [flatRows.length, focusedIndex]);

  const onTreeKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (renamingPath || flatRows.length === 0) return;
      const row = flatRows[focusedIndex];
      if (!row) return;

      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setFocusedIndex((i) => Math.min(flatRows.length - 1, i + 1));
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setFocusedIndex((i) => Math.max(0, i - 1));
        return;
      }
      if (event.key === 'Home') {
        event.preventDefault();
        setFocusedIndex(0);
        return;
      }
      if (event.key === 'End') {
        event.preventDefault();
        setFocusedIndex(flatRows.length - 1);
        return;
      }
      if (event.key === 'ArrowRight' && row.isDir && !expandedSet.has(row.path)) {
        event.preventDefault();
        onToggleFolder(row.path);
        return;
      }
      if (event.key === 'ArrowLeft' && row.isDir && expandedSet.has(row.path)) {
        event.preventDefault();
        onToggleFolder(row.path);
        return;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        if (row.isDir) onToggleFolder(row.path);
        else void onOpenFile(row.path);
        return;
      }
      if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
        const ch = event.key.toLowerCase();
        const state = typeaheadRef.current;
        if (state.timer) clearTimeout(state.timer);
        state.buffer += ch;
        state.timer = setTimeout(() => {
          state.buffer = '';
          state.timer = null;
        }, 300);
        const from = focusedIndex + 1;
        const matchFrom = (start: number) => {
          for (let i = 0; i < flatRows.length; i++) {
            const idx = (start + i) % flatRows.length;
            const candidate = flatRows[idx];
            if (candidate?.name.toLowerCase().startsWith(state.buffer)) return idx;
          }
          return -1;
        };
        const hit = matchFrom(from) >= 0 ? matchFrom(from) : matchFrom(0);
        if (hit >= 0) setFocusedIndex(hit);
      }
    },
    [renamingPath, flatRows, focusedIndex, expandedSet, onToggleFolder, onOpenFile]
  );

  useEffect(() => {
    const row = flatRows[focusedIndex];
    if (!row) return;
    virtualizer.scrollToIndex(focusedIndex, { align: 'auto' });
    rowRefs.current.get(row.path)?.focus();
  }, [focusedIndex, flatRows, virtualizer]);

  const loading = filterActive ? filterLoading : rootLoading;
  const truncated = filterActive && filterTruncated;
  const shownCount = filterActive ? filterPaths.length : flatRows.length;
  const totalCount = filterActive ? filterTotal : flatRows.length;

  if (!workspacePath) {
    return (
      <p className="px-2 py-2 text-meta text-text-faint">Open a workspace to browse files.</p>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <DockFileTreeFilter value={filter} onChange={setFilter} />
      {truncated ? (
        <p className="vx-caption shrink-0 px-1.5 pb-1.5 pt-0.5 text-text-faint">
          Showing {shownCount} of {totalCount} files — narrow folders or use search (Mod+K).
        </p>
      ) : null}
      {loading && flatRows.length === 0 ? (
        <p className="px-2 py-2 text-meta text-text-faint">Loading tree…</p>
      ) : flatRows.length === 0 ? (
        <p className="px-2 py-2 text-meta text-text-faint">
          {filter ? 'No files match the filter.' : 'No files found.'}
        </p>
      ) : (
        <div
          ref={scrollRef}
          className={cn('vx-dock-file-tree scrollbar-stealth min-h-0 flex-1 overflow-y-auto px-1 pb-2')}
          role="tree"
          tabIndex={0}
          onKeyDown={onTreeKeyDown}
        >
          <div
            className="relative w-full"
            style={{ height: `${virtualizer.getTotalSize()}px` }}
          >
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const row = flatRows[virtualRow.index];
              if (!row) return null;
              return (
                <DockFileTreeRow
                  key={row.path}
                  row={row}
                  activePath={activeFilePath}
                  contextTargetPath={target?.path ?? null}
                  gitStatus={gitStatusMap[row.path] ?? null}
                  focused={virtualRow.index === focusedIndex}
                  renaming={renamingPath === row.path}
                  renameValue={renameDraft}
                  onRenameChange={setRenameDraft}
                  onRenameCommit={() => void commitRename()}
                  onRenameCancel={cancelRename}
                  onToggle={onToggleFolder}
                  onOpenFile={onOpenFile}
                  onContextMenu={openContextMenu}
                  setRowRef={setRowRef}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: `${virtualRow.size}px`,
                    transform: `translateY(${virtualRow.start}px)`
                  }}
                />
              );
            })}
          </div>
        </div>
      )}
      {workspaceId ? (
        <DockFileTreeContextMenu
          workspaceId={workspaceId}
          workspacePath={workspacePath}
          target={target}
          anchorRef={anchorRef}
          onClose={closeContextMenu}
          onRefresh={onRefresh}
          onStartInlineRename={startInlineRename}
        />
      ) : null}
    </div>
  );
}
