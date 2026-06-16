/**
 * Collapsible workspace file tree for the left dock — lazy children + virtualization.
 */

import { useCallback, useEffect, useMemo, useRef, useState, startTransition, type KeyboardEvent, type MouseEvent } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useVirtualizer } from '@tanstack/react-virtual';
import { isEditableTextFile } from '@shared/text/isEditableTextFile.js';
import { getWorkspaceTree } from '../../lib/workspaceTreeCache.js';
import { getWorkspaceChildren, invalidateWorkspaceChildrenCache } from '../../lib/workspaceChildrenCache.js';
import { openWorkspaceFileInEditor } from '../../lib/openWorkspaceFileInEditor.js';
import { previewDockWorkspaceFile } from './dockSearchFileActions.js';
import { useWorkspaceStore } from '../../store/useWorkspaceStore.js';
import { useEditorStore } from '../../store/useEditorStore.js';
import { useDockFileTreeRefreshStore } from '../../store/useDockFileTreeRefreshStore.js';
import { useDockFileTreeSelectionStore } from '../../store/useDockFileTreeSelectionStore.js';
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
  flatRowIndexRange,
  flattenDockTreeNodes,
  flattenLazyDockTree,
  normalizeDockTreePath,
  resolveStickyFolderRow,
  siblingFolderPaths,
  type FlatTreeRow
} from './dockFileTreeModel.js';
import { DockFileTreeFilter } from './DockFileTreeFilter.js';
import { DockFileTreeToolbar } from './DockFileTreeToolbar.js';
import { DockFileTreeRow } from './DockFileTreeRow.js';
import { DockFileTreeStickyHeader } from './DockFileTreeStickyHeader.js';
import { PromptDialog } from '../ui/PromptDialog.js';
import {
  DockFileTreeContextMenu,
  useDockFileTreeContextMenu
} from './DockFileTreeContextMenu.js';
import { cn } from '../../lib/cn.js';
import {
  allVisibleRowPaths,
  selectionTargetsFromPaths
} from '../../lib/dockFileTreeSelection.js';

const MAX_RECURSIVE_EXPAND_FOLDERS = 200;
const EMPTY_TREE_SELECTION: string[] = [];

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
  const { expandedSet, toggleExpanded, mergeExpanded, setExpandedSet } = useFileTreeExpanded(workspaceId);
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
  const [createPrompt, setCreatePrompt] = useState<null | { kind: 'newFile' | 'newFolder' }>(null);
  const [stickyRow, setStickyRow] = useState<FlatTreeRow | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const typeaheadRef = useRef({ buffer: '', timer: null as ReturnType<typeof setTimeout> | null });
  const selectionAnchorRef = useRef(0);

  const selectedPathList = useDockFileTreeSelectionStore(
    useShallow((s) => (workspaceId && s.workspaceId === workspaceId ? s.paths : EMPTY_TREE_SELECTION))
  );
  const selectedPaths = useMemo(() => new Set(selectedPathList), [selectedPathList]);
  const setWorkspaceSelection = useDockFileTreeSelectionStore((s) => s.setWorkspaceSelection);
  const clearWorkspaceSelection = useDockFileTreeSelectionStore((s) => s.clearWorkspaceSelection);

  const setSelectedPaths = useCallback(
    (next: Set<string>) => {
      if (!workspaceId) return;
      setWorkspaceSelection(workspaceId, next);
    },
    [workspaceId, setWorkspaceSelection]
  );

  const clearSelection = useCallback(() => {
    if (!workspaceId) return;
    clearWorkspaceSelection(workspaceId);
  }, [workspaceId, clearWorkspaceSelection]);

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

  const selectionTargets = useMemo(
    () => selectionTargetsFromPaths(selectedPaths, flatRows),
    [selectedPaths, flatRows]
  );

  const virtualizer = useVirtualizer({
    count: flatRows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => DOCK_TREE_ROW_HEIGHT_PX,
    overscan: 8,
    getItemKey: (index) => flatRows[index]?.path ?? index
  });

  const onToggleFolder = useCallback(
    (path: string) => {
      setSelectedPaths(new Set());
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

  const expandSiblingFolders = useCallback(() => {
    const row = flatRows[focusedIndex];
    if (!row) return;
    const siblings = siblingFolderPaths(flatRows, row.path);
    if (siblings.length === 0) return;
    mergeExpanded(siblings);
    for (const dir of siblings) {
      if (!childrenByDir.has(dir)) {
        void loadChildren(dir);
      }
    }
  }, [flatRows, focusedIndex, mergeExpanded, childrenByDir, loadChildren]);

  const expandAllFolders = useCallback(async () => {
    if (!workspacePath || filterActive) return;
    const queue = [''];
    const folders: string[] = [];
    const visited = new Set<string>();
    const childrenSnapshot = new Map(childrenByDir);

    const ensureLoaded = async (dir: string): Promise<string[]> => {
      const norm = dir.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/$/, '');
      if (childrenSnapshot.has(norm)) {
        return childrenSnapshot.get(norm) ?? [];
      }
      const entries = await getWorkspaceChildren(workspacePath, norm, workspaceId ?? undefined);
      childrenSnapshot.set(norm, entries);
      setChildrenByDir((prev) => {
        const next = new Map(prev);
        next.set(norm, entries);
        return next;
      });
      return entries;
    };

    while (queue.length > 0 && folders.length < MAX_RECURSIVE_EXPAND_FOLDERS) {
      const dir = queue.shift()!;
      if (visited.has(dir)) continue;
      visited.add(dir);
      const entries = await ensureLoaded(dir);
      for (const raw of entries) {
        if (!raw.endsWith('/')) continue;
        const path = raw.slice(0, -1);
        folders.push(path);
        queue.push(path);
        if (folders.length >= MAX_RECURSIVE_EXPAND_FOLDERS) break;
      }
    }

    if (folders.length > 0) {
      mergeExpanded(folders);
    }
    if (folders.length >= MAX_RECURSIVE_EXPAND_FOLDERS) {
      useToastStore
        .getState()
        .show(`Expanded first ${MAX_RECURSIVE_EXPAND_FOLDERS} folders.`, 'info');
    }
  }, [workspacePath, workspaceId, filterActive, childrenByDir, mergeExpanded]);

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
      if (workspaceId) {
        setWorkspaceSelection(workspaceId, [path]);
      }
      if (isEditableTextFile(path)) {
        await openWorkspaceFileInEditor(path, { workspaceId: workspaceId ?? undefined });
      } else {
        await previewDockWorkspaceFile(path);
      }
      revealPath(path);
    },
    [workspaceId, revealPath, setWorkspaceSelection]
  );

  const onRowPointerDown = useCallback(
    (path: string, _isDir: boolean, event: MouseEvent<HTMLButtonElement>) => {
      const index = flatRows.findIndex((r) => r.path === path);
      if (index < 0) return;
      event.preventDefault();

      if (event.shiftKey) {
        const { from, to } = flatRowIndexRange(selectionAnchorRef.current, index);
        const next = new Set<string>();
        for (let i = from; i <= to; i++) {
          const rowPath = flatRows[i]?.path;
          if (rowPath) next.add(rowPath);
        }
        setSelectedPaths(next);
        setFocusedIndex(index);
        return;
      }

      if (event.ctrlKey || event.metaKey) {
        const next = new Set(selectedPaths);
        if (next.has(path)) next.delete(path);
        else next.add(path);
        setSelectedPaths(next);
        selectionAnchorRef.current = index;
        setFocusedIndex(index);
      }
    },
    [flatRows, selectedPaths]
  );

  const setRowRef = useCallback((path: string, el: HTMLButtonElement | null) => {
    if (el) rowRefs.current.set(path, el);
    else rowRefs.current.delete(path);
  }, []);

  const onRefresh = useCallback(() => {
    useDockFileTreeRefreshStore.getState().bump();
  }, []);

  const onCollapseAll = useCallback(() => {
    setExpandedSet(new Set());
  }, [setExpandedSet]);

  const requestDeleteSelection = useCallback(() => {
    if (selectionTargets.length === 0) return;
    setDeleteDialogOpen(true);
  }, [selectionTargets.length]);

  const handleContextMenu = useCallback(
    (path: string, isDir: boolean, event: MouseEvent<HTMLButtonElement>) => {
      if (!selectedPaths.has(path)) {
        setSelectedPaths(new Set([path]));
        const index = flatRows.findIndex((row) => row.path === path);
        if (index >= 0) selectionAnchorRef.current = index;
      }
      openContextMenu(path, isDir, event);
    },
    [selectedPaths, flatRows, openContextMenu]
  );

  const handleCreateSubmit = useCallback(
    async (name: string) => {
      if (!createPrompt || !workspaceId) return;
      const trimmed = name.trim().replace(/^[/\\]+/, '');
      if (!trimmed) return;
      try {
        if (createPrompt.kind === 'newFolder') {
          await vyotiq.workspace.mkdir({ workspaceId, path: trimmed });
        } else {
          await vyotiq.editor.write({ path: trimmed, content: '', workspaceId });
          await openWorkspaceFileInEditor(trimmed, { workspaceId });
        }
        onRefresh();
      } catch (err) {
        useToastStore.getState().show(err instanceof Error ? err.message : String(err), 'danger');
      } finally {
        setCreatePrompt(null);
      }
    },
    [createPrompt, workspaceId, onRefresh]
  );

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
    selectionAnchorRef.current = Math.min(selectionAnchorRef.current, Math.max(0, flatRows.length - 1));
  }, [flatRows.length, focusedIndex]);

  const syncStickyHeader = useCallback(() => {
    const el = scrollRef.current;
    if (!el) {
      setStickyRow(null);
      return;
    }
    setStickyRow(resolveStickyFolderRow(flatRows, el.scrollTop));
  }, [flatRows]);

  useEffect(() => {
    syncStickyHeader();
  }, [syncStickyHeader]);

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
      if (event.key === 'Escape') {
        event.preventDefault();
        setSelectedPaths(new Set());
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
        event.preventDefault();
        setSelectedPaths(new Set(allVisibleRowPaths(flatRows)));
        return;
      }
      if (event.key === 'Delete' && selectedPaths.size > 0) {
        event.preventDefault();
        requestDeleteSelection();
        return;
      }
      if (event.key === '*' || event.code === 'NumpadMultiply') {
        event.preventDefault();
        if (event.shiftKey) {
          void expandAllFolders();
        } else {
          expandSiblingFolders();
        }
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
    [renamingPath, flatRows, focusedIndex, expandedSet, selectedPaths.size, onToggleFolder, onOpenFile, expandSiblingFolders, expandAllFolders, requestDeleteSelection]
  );

  useEffect(() => {
    const row = flatRows[focusedIndex];
    if (!row) return;
    selectionAnchorRef.current = focusedIndex;
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
      <div className="vx-dock-file-tree-chrome shrink-0 border-b border-border-subtle/25">
        <DockFileTreeFilter value={filter} onChange={setFilter} />
        <DockFileTreeToolbar
          disabled={!workspaceId}
          onNewFile={() => setCreatePrompt({ kind: 'newFile' })}
          onNewFolder={() => setCreatePrompt({ kind: 'newFolder' })}
          onExpandAll={() => void expandAllFolders()}
          onCollapseAll={onCollapseAll}
          onRefresh={onRefresh}
          selectionCount={selectedPaths.size}
          onDeleteSelection={requestDeleteSelection}
        />
      </div>
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
          className={cn('vx-dock-file-tree scrollbar-stealth relative min-h-0 flex-1 overflow-y-auto px-1 pb-2')}
          role="tree"
          aria-multiselectable
          tabIndex={0}
          onKeyDown={onTreeKeyDown}
          onScroll={syncStickyHeader}
        >
          {stickyRow ? (
            <DockFileTreeStickyHeader row={stickyRow} onToggle={onToggleFolder} />
          ) : null}
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
                  selected={selectedPaths.has(row.path)}
                  renaming={renamingPath === row.path}
                  renameValue={renameDraft}
                  onRenameChange={setRenameDraft}
                  onRenameCommit={() => void commitRename()}
                  onRenameCancel={cancelRename}
                  onToggle={onToggleFolder}
                  onOpenFile={onOpenFile}
                  onRowPointerDown={onRowPointerDown}
                  onContextMenu={handleContextMenu}
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
          selectionTargets={selectionTargets}
          anchorRef={anchorRef}
          onClose={closeContextMenu}
          onRefresh={onRefresh}
          onStartInlineRename={startInlineRename}
          onSelectionDeleted={clearSelection}
          deleteDialogOpen={deleteDialogOpen}
          onDeleteDialogOpenChange={setDeleteDialogOpen}
        />
      ) : null}
      <PromptDialog
        open={createPrompt !== null}
        title={createPrompt?.kind === 'newFolder' ? 'New folder' : 'New file'}
        placeholder={createPrompt?.kind === 'newFolder' ? 'folder-name' : 'file-name.ext'}
        initialValue=""
        onSubmit={(v) => void handleCreateSubmit(v)}
        onCancel={() => setCreatePrompt(null)}
      />
    </div>
  );
}
