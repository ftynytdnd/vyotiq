/**
 * Collapsible open editors list above the workspace file tree.
 */

import { useCallback, useMemo, useRef, useState, type DragEvent, type MouseEvent } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { ChevronDown, ChevronRight, GripVertical, X } from 'lucide-react';
import { basenameFromPath } from '@shared/text/languageFromPath.js';
import { useEditorStore } from '../../store/useEditorStore.js';
import { useSettingsStore } from '../../store/useSettingsStore.js';
import { useDockFileTreeSelectionStore } from '../../store/useDockFileTreeSelectionStore.js';
import { vyotiq } from '../../lib/ipc.js';
import { revealFileInDockTree } from '../../lib/revealFileInDockTree.js';
import { focusWorkbenchTab } from '../workbench/workbenchShared.js';
import { flatRowIndexRange } from './dockFileTreeModel.js';
import { EDITOR_TAB_DRAG_MIME } from './dockShared.js';
import { FileIconForPath } from '../../lib/fileIconForPath.js';
import { cn } from '../../lib/cn.js';
import { SHELL_ACTION_ICON_STROKE, SHELL_COMPACT_ICON_CLASS, SHELL_ROW_ICON_CLASS } from '../../lib/shellIcons.js';

export interface DockOpenEditorsSectionProps {
  workspaceId: string;
}

const EMPTY_TREE_SELECTION: string[] = [];

export function DockOpenEditorsSection({ workspaceId }: DockOpenEditorsSectionProps) {
  const tabs = useEditorStore(
    useShallow((s) => s.tabs.filter((t) => t.workspaceId === workspaceId))
  );
  const activeFilePath = useEditorStore((s) => s.activeFilePath);
  const requestCloseTab = useEditorStore((s) => s.requestCloseTab);
  const setActiveTab = useEditorStore((s) => s.setActiveTab);
  const reorderWorkspaceTabs = useEditorStore((s) => s.reorderWorkspaceTabs);

  const selectedPathList = useDockFileTreeSelectionStore(
    useShallow((s) => (s.workspaceId === workspaceId ? s.paths : EMPTY_TREE_SELECTION))
  );
  const selectedPaths = useMemo(() => new Set(selectedPathList), [selectedPathList]);
  const setWorkspaceSelection = useDockFileTreeSelectionStore((s) => s.setWorkspaceSelection);
  const togglePath = useDockFileTreeSelectionStore((s) => s.togglePath);

  const selectionAnchorRef = useRef(0);
  const [dragPath, setDragPath] = useState<string | null>(null);
  const [dropTargetPath, setDropTargetPath] = useState<string | null>(null);

  const collapsed = useSettingsStore(
    (s) => s.settings.ui?.openEditorsCollapsedByWorkspace?.[workspaceId] === true
  );

  const setCollapsed = useCallback(
    (next: boolean) => {
      const settings = useSettingsStore.getState().settings;
      const prev = settings.ui?.openEditorsCollapsedByWorkspace ?? {};
      void vyotiq.settings.set({
        ui: { openEditorsCollapsedByWorkspace: { ...prev, [workspaceId]: next } }
      });
      useSettingsStore.setState({
        settings: {
          ...settings,
          ui: {
            ...settings.ui,
            openEditorsCollapsedByWorkspace: { ...prev, [workspaceId]: next }
          }
        }
      });
    },
    [workspaceId]
  );

  const rows = useMemo(
    () =>
      tabs.map((tab) => ({
        filePath: tab.filePath,
        name: basenameFromPath(tab.filePath),
        dirty: tab.content !== tab.savedContent,
        active: activeFilePath === tab.filePath
      })),
    [tabs, activeFilePath]
  );

  const activateRow = useCallback(
    (filePath: string) => {
      setActiveTab(filePath);
      focusWorkbenchTab('editor');
      setWorkspaceSelection(workspaceId, [filePath]);
      revealFileInDockTree(filePath);
    },
    [workspaceId, setActiveTab, setWorkspaceSelection]
  );

  const onRowClick = useCallback(
    (filePath: string, index: number, event: MouseEvent<HTMLButtonElement>) => {
      if (event.shiftKey) {
        event.preventDefault();
        const { from, to } = flatRowIndexRange(selectionAnchorRef.current, index);
        const next = new Set<string>();
        for (let i = from; i <= to; i++) {
          const path = rows[i]?.filePath;
          if (path) next.add(path);
        }
        setWorkspaceSelection(workspaceId, next);
        return;
      }

      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        togglePath(workspaceId, filePath);
        selectionAnchorRef.current = index;
        return;
      }

      activateRow(filePath);
      selectionAnchorRef.current = index;
    },
    [workspaceId, rows, setWorkspaceSelection, togglePath, activateRow]
  );

  const onDropOnRow = useCallback(
    (targetPath: string, event: DragEvent<HTMLLIElement>) => {
      event.preventDefault();
      const fromPath = event.dataTransfer.getData(EDITOR_TAB_DRAG_MIME);
      if (fromPath && fromPath !== targetPath) {
        reorderWorkspaceTabs(workspaceId, fromPath, targetPath);
      }
      setDragPath(null);
      setDropTargetPath(null);
    },
    [workspaceId, reorderWorkspaceTabs]
  );

  if (rows.length === 0) return null;

  return (
    <section className="shrink-0 border-b border-border-subtle/20 px-1.5 pb-1.5 pt-1">
      <button
        type="button"
        className="flex w-full items-center gap-1 rounded-md px-1 py-0.5 text-left font-mono text-meta text-text-faint hover:bg-chrome-hover-soft hover:text-text-secondary"
        aria-expanded={!collapsed}
        onClick={() => setCollapsed(!collapsed)}
      >
        {collapsed ? (
          <ChevronRight className={SHELL_ROW_ICON_CLASS} strokeWidth={SHELL_ACTION_ICON_STROKE} />
        ) : (
          <ChevronDown className={SHELL_ROW_ICON_CLASS} strokeWidth={SHELL_ACTION_ICON_STROKE} />
        )}
        <span>Open editors</span>
        <span className="ml-auto tabular-nums">{rows.length}</span>
      </button>
      {!collapsed ? (
        <ul className="mt-0.5 flex flex-col gap-0.5">
          {rows.map((row, index) => {
            const selected = selectedPaths.has(row.filePath);
            const isDropTarget = dropTargetPath === row.filePath && dragPath !== row.filePath;
            return (
              <li
                key={row.filePath}
                className={cn(
                  'group flex min-w-0 items-center gap-0.5 rounded-md',
                  isDropTarget && 'bg-accent/10 ring-1 ring-inset ring-accent/30'
                )}
                onDragOver={(event) => {
                  if (!event.dataTransfer.types.includes(EDITOR_TAB_DRAG_MIME)) return;
                  event.preventDefault();
                  event.dataTransfer.dropEffect = 'move';
                  setDropTargetPath(row.filePath);
                }}
                onDragLeave={() => {
                  if (dropTargetPath === row.filePath) setDropTargetPath(null);
                }}
                onDrop={(event) => onDropOnRow(row.filePath, event)}
              >
                <button
                  type="button"
                  draggable
                  className="cursor-grab rounded p-0.5 text-text-faint opacity-0 hover:bg-chrome-hover-soft hover:text-text-secondary group-hover:opacity-100 active:cursor-grabbing"
                  aria-label={`Reorder ${row.name}`}
                  onDragStart={(event) => {
                    event.dataTransfer.setData(EDITOR_TAB_DRAG_MIME, row.filePath);
                    event.dataTransfer.effectAllowed = 'move';
                    setDragPath(row.filePath);
                  }}
                  onDragEnd={() => {
                    setDragPath(null);
                    setDropTargetPath(null);
                  }}
                  onClick={(event) => event.stopPropagation()}
                >
                  <GripVertical className={SHELL_COMPACT_ICON_CLASS} strokeWidth={SHELL_ACTION_ICON_STROKE} />
                </button>
                <button
                  type="button"
                  className={cn(
                    'flex min-w-0 flex-1 items-center gap-1 rounded-md py-0.5 pl-1 pr-1 text-left font-mono text-row hover:bg-chrome-hover-soft',
                    row.active && 'vx-dock-open-editor-row-active text-text-primary',
                    selected && !row.active && 'vx-dock-file-tree-row-selected bg-accent/5 ring-1 ring-inset ring-accent/25',
                    !row.active && !selected && 'text-text-secondary'
                  )}
                  onClick={(event) => onRowClick(row.filePath, index, event)}
                  onDoubleClick={() => revealFileInDockTree(row.filePath)}
                  title={row.filePath}
                >
                  <FileIconForPath filePath={row.filePath} />
                  <span
                    className={cn(
                      'h-1.5 w-1.5 shrink-0 rounded-full',
                      row.dirty ? 'bg-warning' : 'bg-transparent'
                    )}
                    aria-hidden
                  />
                  <span className="truncate">{row.name}</span>
                </button>
                <button
                  type="button"
                  className="rounded p-0.5 text-text-faint opacity-0 hover:bg-chrome-hover-soft hover:text-text-secondary group-hover:opacity-100"
                  aria-label={`Close ${row.name}`}
                  onClick={() => requestCloseTab(row.filePath)}
                >
                  <X className={SHELL_COMPACT_ICON_CLASS} strokeWidth={SHELL_ACTION_ICON_STROKE} />
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}
