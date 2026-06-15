/**
 * Right-click context menu for dock file tree rows.
 */

import { useCallback, useEffect, useRef, useState, type MouseEvent } from 'react';
import { Popover } from '../ui/Popover.js';
import { PromptDialog } from '../ui/PromptDialog.js';
import { DestructiveConfirm } from '../ui/DestructiveConfirm.js';
import { vyotiq } from '../../lib/ipc.js';
import { useToastStore } from '../../store/useToastStore.js';
import { useTerminalStore } from '../../store/useTerminalStore.js';
import { useEditorStore } from '../../store/useEditorStore.js';
import { openWorkspaceFileInEditor } from '../../lib/openWorkspaceFileInEditor.js';
import { previewDockWorkspaceFile } from './dockSearchFileActions.js';
import { isEditableTextFile } from '@shared/text/isEditableTextFile.js';
import { cn } from '../../lib/cn.js';
import { readTitlebarInsetPx } from '../ui/popoverPosition.js';
import type { DockTreeDeleteTarget } from '../../lib/dockFileTreeSelection.js';
import {
  closeTabsForDeleteTargets,
  deleteWorkspaceTargets,
  remainingTabsForTargets
} from '../../lib/dockFileTreeDelete.js';

export interface DockFileTreeContextTarget {
  path: string;
  isDir: boolean;
}

interface DockFileTreeContextMenuProps {
  workspaceId: string;
  workspacePath: string;
  target: DockFileTreeContextTarget | null;
  selectionTargets: readonly DockTreeDeleteTarget[];
  anchorRef: React.RefObject<HTMLElement | null>;
  onClose: () => void;
  onRefresh: () => void;
  onStartInlineRename: (path: string) => void;
  onSelectionDeleted?: () => void;
  deleteDialogOpen?: boolean;
  onDeleteDialogOpenChange?: (open: boolean) => void;
}

function menuItemClassName(): string {
  return cn(
    'flex w-full items-center rounded-md px-2 py-1.5 text-left font-mono text-row text-text-secondary',
    'hover:bg-chrome-hover-soft hover:text-text-primary'
  );
}

async function copyText(text: string, okMessage: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    useToastStore.getState().show(okMessage, 'success');
  } catch {
    useToastStore.getState().show('Could not copy to clipboard.', 'danger');
  }
}

function joinWorkspacePath(root: string, rel: string): string {
  const sep = root.includes('\\') ? '\\' : '/';
  return `${root.replace(/[/\\]+$/, '')}${sep}${rel.replace(/^[/\\]+/, '')}`;
}

async function openInTerminal(workspaceId: string, workspacePath: string, relPath: string): Promise<void> {
  const term = useTerminalStore.getState();
  await term.openPanel(workspaceId);
  const sessionId = term.activeSessionId ?? term.sessions[0]?.sessionId;
  if (!sessionId) {
    useToastStore.getState().show('No terminal session available.', 'danger');
    return;
  }
  const abs = joinWorkspacePath(workspacePath, relPath);
  const isWin = workspacePath.includes('\\') || /^[a-zA-Z]:/.test(workspacePath);
  const cmd = isWin ? `Set-Location -LiteralPath '${abs.replace(/'/g, "''")}'\r` : `cd '${abs.replace(/'/g, "'\\''")}'\r`;
  await vyotiq.terminal.input({ sessionId, data: cmd });
}

export function DockFileTreeContextMenu({
  workspaceId,
  workspacePath,
  target,
  selectionTargets,
  anchorRef,
  onClose,
  onRefresh,
  onStartInlineRename,
  onSelectionDeleted,
  deleteDialogOpen = false,
  onDeleteDialogOpenChange
}: DockFileTreeContextMenuProps) {
  const [prompt, setPrompt] = useState<
    null | { kind: 'newFile' | 'newFolder'; basePath: string }
  >(null);
  const [internalDeleteOpen, setInternalDeleteOpen] = useState(false);
  const [pendingDeleteTargets, setPendingDeleteTargets] = useState<
    readonly DockTreeDeleteTarget[] | null
  >(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  const deleteOpen = deleteDialogOpen || internalDeleteOpen;
  const setDeleteOpen = onDeleteDialogOpenChange ?? setInternalDeleteOpen;
  const multiDelete = selectionTargets.length > 1;
  const deleteTargets = selectionTargets.length > 0 ? selectionTargets : target ? [target] : [];

  const runOpen = useCallback(async () => {
    if (!target) return;
    onClose();
    if (target.isDir) return;
    if (isEditableTextFile(target.path)) {
      await openWorkspaceFileInEditor(target.path, { workspaceId });
    } else {
      await previewDockWorkspaceFile(target.path);
    }
  }, [target, workspaceId, onClose]);

  const onNewFile = useCallback(() => {
    if (!target) return;
    const base = target.isDir ? target.path : target.path.replace(/[/\\][^/\\]+$/, '');
    setPrompt({ kind: 'newFile', basePath: base });
    onClose();
  }, [target, onClose]);

  const onNewFolder = useCallback(() => {
    if (!target) return;
    const base = target.isDir ? target.path : target.path.replace(/[/\\][^/\\]+$/, '');
    setPrompt({ kind: 'newFolder', basePath: base });
    onClose();
  }, [target, onClose]);

  const onRename = useCallback(() => {
    if (!target || multiDelete) return;
    onStartInlineRename(target.path);
    onClose();
  }, [target, multiDelete, onStartInlineRename, onClose]);

  const onDeleteRequest = useCallback(() => {
    onClose();
    setDeleteOpen(true);
  }, [onClose, setDeleteOpen]);

  const onCopyPath = useCallback(async () => {
    if (deleteTargets.length === 0) return;
    const abs = deleteTargets
      .map((item) => joinWorkspacePath(workspacePath, item.path))
      .join('\n');
    await copyText(abs, deleteTargets.length > 1 ? 'Paths copied.' : 'Path copied.');
    onClose();
  }, [deleteTargets, workspacePath, onClose]);

  const onCopyRelative = useCallback(async () => {
    if (deleteTargets.length === 0) return;
    await copyText(
      deleteTargets.map((item) => item.path).join('\n'),
      deleteTargets.length > 1 ? 'Relative paths copied.' : 'Relative path copied.'
    );
    onClose();
  }, [deleteTargets, onClose]);

  const onReveal = useCallback(async () => {
    if (!target) return;
    try {
      await vyotiq.workspace.revealPath({ workspaceId, path: target.path });
    } catch (err) {
      useToastStore.getState().show(err instanceof Error ? err.message : String(err), 'danger');
    }
    onClose();
  }, [target, workspaceId, onClose]);

  const onTerminal = useCallback(async () => {
    if (!target) return;
    const dir = target.isDir ? target.path : target.path.replace(/[/\\][^/\\]+$/, '');
    try {
      await openInTerminal(workspaceId, workspacePath, dir || '.');
    } catch (err) {
      useToastStore.getState().show(err instanceof Error ? err.message : String(err), 'danger');
    }
    onClose();
  }, [target, workspaceId, workspacePath, onClose]);

  const handlePromptSubmit = useCallback(
    async (name: string) => {
      if (!prompt) return;
      const trimmed = name.trim().replace(/^[/\\]+/, '');
      if (!trimmed) return;
      try {
        if (prompt.kind === 'newFolder') {
          const rel = prompt.basePath ? `${prompt.basePath}/${trimmed}` : trimmed;
          await vyotiq.workspace.mkdir({ workspaceId, path: rel });
        } else {
          const rel = prompt.basePath ? `${prompt.basePath}/${trimmed}` : trimmed;
          await vyotiq.editor.write({ path: rel, content: '', workspaceId });
          await openWorkspaceFileInEditor(rel, { workspaceId });
        }
        onRefresh();
      } catch (err) {
        useToastStore.getState().show(err instanceof Error ? err.message : String(err), 'danger');
      } finally {
        setPrompt(null);
      }
    },
    [prompt, workspaceId, onRefresh]
  );

  const executeDelete = useCallback(
    async (targets: readonly DockTreeDeleteTarget[]) => {
      try {
        await deleteWorkspaceTargets(workspaceId, targets);
        onRefresh();
        onSelectionDeleted?.();
      } catch (err) {
        useToastStore.getState().show(err instanceof Error ? err.message : String(err), 'danger');
      }
    },
    [workspaceId, onRefresh, onSelectionDeleted]
  );

  const handleDelete = useCallback(async () => {
    if (deleteTargets.length === 0) return;
    if (!closeTabsForDeleteTargets(deleteTargets)) {
      setPendingDeleteTargets(deleteTargets);
      setDeleteOpen(false);
      return;
    }
    await executeDelete(deleteTargets);
    setDeleteOpen(false);
  }, [deleteTargets, executeDelete, setDeleteOpen]);

  useEffect(() => {
    if (!pendingDeleteTargets) return;
    return useEditorStore.subscribe((state, prev) => {
      if (state.pendingUnsavedClose) return;
      if (prev.pendingUnsavedClose && !state.pendingUnsavedClose) {
        const remaining = remainingTabsForTargets(pendingDeleteTargets);
        if (remaining.length > 0) {
          if (!closeTabsForDeleteTargets(pendingDeleteTargets)) return;
        }
        void executeDelete(pendingDeleteTargets);
        setPendingDeleteTargets(null);
      }
    });
  }, [pendingDeleteTargets, executeDelete]);

  const promptTitle = prompt?.kind === 'newFolder' ? 'New folder' : 'New file';

  return (
    <>
      <Popover
        open={target !== null}
        onClose={onClose}
        triggerRef={anchorRef}
        anchorRef={anchorRef}
        preferSide="auto"
        align="start"
        offset={4}
        widthMode="content"
        fitMaxWidth={280}
        collisionPadding={{
          top: readTitlebarInsetPx(),
          bottom: 12,
          left: 8,
          right: 8
        }}
        className="min-w-[11rem] max-w-[17.5rem] rounded-md border border-border-subtle/40 bg-surface-overlay p-1 shadow-popover"
      >
        <div ref={popoverRef} role="menu" className="flex flex-col gap-0.5 overflow-y-auto">
          {!target?.isDir ? (
            <button type="button" role="menuitem" className={menuItemClassName()} onClick={() => void runOpen()}>
              Open
            </button>
          ) : null}
          <button type="button" role="menuitem" className={menuItemClassName()} onClick={onNewFile}>
            New file…
          </button>
          <button type="button" role="menuitem" className={menuItemClassName()} onClick={onNewFolder}>
            New folder…
          </button>
          <button
            type="button"
            role="menuitem"
            className={menuItemClassName()}
            onClick={onRename}
            disabled={multiDelete}
          >
            Rename…
          </button>
          <button type="button" role="menuitem" className={menuItemClassName()} onClick={onDeleteRequest}>
            {multiDelete ? `Delete ${selectionTargets.length} items…` : 'Delete…'}
          </button>
          <div className="my-0.5 h-px bg-border-subtle/30" role="separator" />
          <button type="button" role="menuitem" className={menuItemClassName()} onClick={() => void onCopyPath()}>
            Copy path
          </button>
          <button type="button" role="menuitem" className={menuItemClassName()} onClick={() => void onCopyRelative()}>
            Copy relative path
          </button>
          <button type="button" role="menuitem" className={menuItemClassName()} onClick={() => void onReveal()}>
            Reveal in Explorer
          </button>
          <button type="button" role="menuitem" className={menuItemClassName()} onClick={() => void onTerminal()}>
            Open in terminal
          </button>
        </div>
      </Popover>

      <PromptDialog
        open={prompt !== null}
        title={promptTitle}
        placeholder={prompt?.kind === 'newFolder' ? 'folder-name' : 'file-name.ext'}
        initialValue=""
        onSubmit={(v) => void handlePromptSubmit(v)}
        onCancel={() => setPrompt(null)}
      />

      <DestructiveConfirm
        variant="composer"
        open={deleteOpen}
        title={multiDelete ? 'Delete selected items?' : 'Delete path?'}
        message={
          multiDelete
            ? `Delete ${selectionTargets.length} selected items? This cannot be undone.`
            : deleteTargets[0]
              ? `Delete "${deleteTargets[0].path}"${deleteTargets[0].isDir ? ' and its contents' : ''}? This cannot be undone.`
              : ''
        }
        confirmLabel="Delete"
        onConfirm={() => void handleDelete()}
        onCancel={() => setDeleteOpen(false)}
      />
    </>
  );
}

export function useDockFileTreeContextMenu() {
  const anchorRef = useRef<HTMLButtonElement>(null);
  const [target, setTarget] = useState<DockFileTreeContextTarget | null>(null);

  const openContextMenu = useCallback(
    (path: string, isDir: boolean, event: MouseEvent<HTMLButtonElement>) => {
      anchorRef.current = event.currentTarget;
      setTarget({ path, isDir });
    },
    []
  );

  const closeContextMenu = useCallback(() => setTarget(null), []);

  return { anchorRef, target, openContextMenu, closeContextMenu };
}
