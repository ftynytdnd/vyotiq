/**
 * Editor empty state — open / create file and recent paths.
 */

import { useCallback, useMemo, useState } from 'react';
import { FilePlus, FolderOpen } from 'lucide-react';
import { basenameFromPath } from '@shared/text/languageFromPath.js';
import { Button } from '../ui/Button.js';
import { useUiStore } from '../../store/useUiStore.js';
import { useEditorStore } from '../../store/useEditorStore.js';
import { useWorkspaceStore } from '../../store/useWorkspaceStore.js';
import { openWorkspaceFileInEditor } from '../../lib/openWorkspaceFileInEditor.js';
import { readRecentEditorFiles } from '../../lib/recentEditorFiles.js';
import { vyotiq } from '../../lib/ipc.js';
import { useToastStore } from '../../store/useToastStore.js';
import { useSettingsStore } from '../../store/useSettingsStore.js';
import { SHELL_ACTION_ICON_STROKE, SHELL_ROW_ICON_CLASS } from '../../lib/shellIcons.js';
import { WORKBENCH_BODY_CLASS, closeEditorPanel } from './workbenchShared.js';
import { WORKBENCH_EMPTY_CARD_CLASS } from './workbenchChrome.js';
import { cn } from '../../lib/cn.js';

export function EditorEmptyState() {
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeId);
  const workspacePath = useWorkspaceStore((s) => s.info.path);
  const setDockExpanded = useUiStore((s) => s.setDockExpanded);
  const setDockPanelTab = useUiStore((s) => s.setDockPanelTab);
  const settings = useSettingsStore((s) => s.settings);
  const [newFileOpen, setNewFileOpen] = useState(false);
  const [newFilePath, setNewFilePath] = useState('');
  const [creating, setCreating] = useState(false);

  const recent = useMemo(
    () => readRecentEditorFiles(activeWorkspaceId),
    [activeWorkspaceId, settings.ui?.recentEditorFilesByWorkspace]
  );

  const onOpenFile = useCallback(() => {
    useEditorStore.getState().openPanel();
    setDockPanelTab('files');
    setDockExpanded(true);
  }, [setDockExpanded, setDockPanelTab]);

  const onNewFile = useCallback(() => {
    setNewFilePath('');
    setNewFileOpen(true);
  }, []);

  const onCreateFile = useCallback(async () => {
    const rel = newFilePath.trim().replace(/^[/\\]+/, '');
    if (!rel || !activeWorkspaceId) return;
    setCreating(true);
    try {
      const reply = await vyotiq.editor.write({
        path: rel,
        content: '',
        workspaceId: activeWorkspaceId
      });
      if (!reply.ok) {
        useToastStore.getState().show('Could not create file.', 'danger');
        return;
      }
      setNewFileOpen(false);
      await openWorkspaceFileInEditor(rel, { workspaceId: activeWorkspaceId });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      useToastStore.getState().show(msg, 'danger');
    } finally {
      setCreating(false);
    }
  }, [activeWorkspaceId, newFilePath]);

  const onOpenRecent = useCallback(
    (path: string) => {
      if (!activeWorkspaceId) return;
      void openWorkspaceFileInEditor(path, { workspaceId: activeWorkspaceId });
    },
    [activeWorkspaceId]
  );

  return (
    <div
      className={cn(
        WORKBENCH_BODY_CLASS,
        'vx-editor-empty relative flex items-center justify-center px-6 py-10'
      )}
    >
      <div className={cn('flex w-full max-w-md flex-col items-center gap-6 text-center', WORKBENCH_EMPTY_CARD_CLASS)}>
        <div className="space-y-1">
          <p className="text-section font-medium text-text-primary">No file open</p>
          <p className="text-row text-text-muted">
            {workspacePath
              ? 'Open a workspace file or create a new one.'
              : 'Choose a workspace to edit files.'}
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Button variant="secondary" size="sm" onClick={onOpenFile} disabled={!workspacePath}>
            <FolderOpen className={SHELL_ROW_ICON_CLASS} strokeWidth={SHELL_ACTION_ICON_STROKE} />
            Open file
          </Button>
          <Button variant="primary" size="sm" onClick={onNewFile} disabled={!workspacePath}>
            <FilePlus className={SHELL_ROW_ICON_CLASS} strokeWidth={SHELL_ACTION_ICON_STROKE} />
            New file
          </Button>
          <Button variant="ghost" size="sm" onClick={() => closeEditorPanel()}>
            Close editor
          </Button>
        </div>
        {recent.length > 0 ? (
          <div className="w-full space-y-2 text-left">
            <p className="text-meta font-medium uppercase tracking-wide text-text-faint">Recent</p>
            <ul className="space-y-0.5">
              {recent.map((path) => (
                <li key={path}>
                  <button
                    type="button"
                    className="w-full truncate rounded-md px-2 py-1.5 text-left font-mono text-row text-text-secondary chrome-hover-soft"
                    title={path}
                    onClick={() => onOpenRecent(path)}
                  >
                    {basenameFromPath(path)}
                    <span className="ml-2 text-text-faint">{path}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>

      {newFileOpen ? (
        <div
          className="absolute inset-0 z-20 flex items-center justify-center bg-scrim/60 p-4"
          role="presentation"
          onClick={() => !creating && setNewFileOpen(false)}
        >
          <form
            className="w-full max-w-md rounded-lg border border-border-subtle/40 bg-surface-raised p-4 shadow-lg"
            role="dialog"
            aria-label="New file"
            onClick={(e) => e.stopPropagation()}
            onSubmit={(e) => {
              e.preventDefault();
              void onCreateFile();
            }}
          >
            <p className="text-section font-medium text-text-primary">New file</p>
            <p className="mt-1 text-row text-text-muted">Workspace-relative path</p>
            <input
              type="text"
              className="vx-input mt-3 w-full font-mono text-row"
              placeholder="src/example.ts"
              value={newFilePath}
              autoFocus
              disabled={creating}
              onChange={(e) => setNewFilePath(e.target.value)}
            />
            <div className="mt-4 flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={creating}
                onClick={() => setNewFileOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="primary"
                size="sm"
                disabled={creating || newFilePath.trim().length === 0}
              >
                Create
              </Button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}
