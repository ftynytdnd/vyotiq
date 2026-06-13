/**
 * Secondary-zone floating editor panel — read/write workspace files.
 */

import { useCallback, useMemo } from 'react';
import { ExternalLink, RotateCcw, Save, X } from 'lucide-react';
import { basenameFromPath } from '@shared/text/languageFromPath.js';
import {
  resolveCompletionModelSelection,
  resolveInlineCompletionSettings
} from '@shared/settings/inlineCompletionSettings.js';
import type { ModelSelection } from '@shared/types/provider.js';
import { FloatingPanel } from '../ui/FloatingPanel.js';
import { LoadingHint } from '../ui/LoadingHint.js';
import { Button } from '../ui/Button.js';
import { CodeEditor } from './CodeEditor.js';
import {
  selectActiveEditorTab,
  selectEditorDirty,
  useEditorStore
} from '../../store/useEditorStore.js';
import { vyotiq } from '../../lib/ipc.js';
import { useToastStore } from '../../store/useToastStore.js';
import { useSettingsStore } from '../../store/useSettingsStore.js';
import { useWorkspaceStore } from '../../store/useWorkspaceStore.js';
import { SHELL_ACTION_ICON_STROKE, SHELL_ROW_ICON_CLASS } from '../../lib/shellIcons.js';
import { cn } from '../../lib/cn.js';
import { useEditorLsp } from '../../hooks/useEditorLsp.js';

export interface EditorPanelProps {
  initialWidth?: number;
  onWidthChange?: (w: number) => void;
}

export function EditorPanel({ initialWidth, onWidthChange }: EditorPanelProps) {
  const open = useEditorStore((s) => s.open);
  const tabs = useEditorStore((s) => s.tabs);
  const activeFilePath = useEditorStore((s) => s.activeFilePath);
  const activeTab = useEditorStore(selectActiveEditorTab);
  const filePath = activeTab?.filePath ?? null;
  const workspaceId = activeTab?.workspaceId ?? null;
  const content = activeTab?.content ?? '';
  const loading = activeTab?.loading ?? false;
  const saving = activeTab?.saving ?? false;
  const truncated = activeTab?.truncated ?? false;
  const staleOnDisk = activeTab?.staleOnDisk ?? false;
  const dirty = useEditorStore(selectEditorDirty);
  const close = useEditorStore((s) => s.close);
  const closeTab = useEditorStore((s) => s.closeTab);
  const setActiveTab = useEditorStore((s) => s.setActiveTab);
  const setContent = useEditorStore((s) => s.setContent);
  const save = useEditorStore((s) => s.save);
  const reloadFromDisk = useEditorStore((s) => s.reloadFromDisk);
  const settings = useSettingsStore((s) => s.settings);
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeId);

  const lsp = useEditorLsp({
    enabled: settings.ui?.editorLsp?.enabled === true,
    filePath,
    workspaceId: workspaceId ?? activeWorkspaceId
  });

  const inlineCompletion = useMemo(() => {
    const ic = resolveInlineCompletionSettings(settings.ui);
    if (!ic.enabled || !ic.editorEnabled || !filePath || !workspaceId) return null;
    const wsLast =
      activeWorkspaceId && settings.ui?.lastModelByWorkspace?.[activeWorkspaceId]
        ? settings.ui.lastModelByWorkspace[activeWorkspaceId]
        : null;
    const fallback: ModelSelection | null = wsLast ?? settings.defaultModel ?? null;
    const model = resolveCompletionModelSelection(ic, fallback);
    if (!model) return null;
    return {
      enabled: true,
      debounceMs: ic.debounceMs,
      providerId: model.providerId,
      modelId: model.modelId,
      filePath,
      workspaceId
    };
  }, [activeWorkspaceId, filePath, settings.defaultModel, settings.ui, workspaceId]);

  const title = filePath ? basenameFromPath(filePath) : 'Editor';

  const onOpenExternal = useCallback(async () => {
    if (!filePath) return;
    try {
      await vyotiq.tools.openPath(filePath, workspaceId ?? undefined);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      useToastStore.getState().show(msg, 'danger');
    }
  }, [filePath, workspaceId]);

  const headerActions = (
    <div className="flex items-center gap-1">
      <Button
        variant="ghost"
        size="sm"
        onClick={() => void reloadFromDisk()}
        disabled={loading || !filePath}
        title="Reload from disk"
      >
        <RotateCcw className={SHELL_ROW_ICON_CLASS} strokeWidth={SHELL_ACTION_ICON_STROKE} />
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => void onOpenExternal()}
        disabled={!filePath}
        title="Open in default app"
      >
        <ExternalLink className={SHELL_ROW_ICON_CLASS} strokeWidth={SHELL_ACTION_ICON_STROKE} />
      </Button>
      <Button
        variant={dirty ? 'primary' : 'secondary'}
        size="sm"
        onClick={() => void save()}
        disabled={!dirty || saving || loading || !filePath}
        title="Save (Ctrl+S)"
      >
        <Save className={SHELL_ROW_ICON_CLASS} strokeWidth={SHELL_ACTION_ICON_STROKE} />
        Save
      </Button>
    </div>
  );

  return (
    <FloatingPanel
      open={open}
      onClose={close}
      title={dirty ? `${title} •` : title}
      widthKey="workspaceEditor"
      {...(initialWidth !== undefined ? { initialWidth } : {})}
      {...(onWidthChange ? { onWidthChange } : {})}
      className="vx-editor-panel"
      headerActions={headerActions}
    >
      <div className="vx-editor-panel-body flex h-full min-h-0 flex-col">
        {tabs.length > 0 ? (
          <div className="vx-editor-tabs flex shrink-0 gap-0.5 overflow-x-auto border-b border-border-subtle/30 px-2 py-1">
            {tabs.map((tab) => {
              const active = tab.filePath === activeFilePath;
              const tabDirty = tab.content !== tab.savedContent;
              return (
                <div
                  key={tab.filePath}
                  className={cn(
                    'flex max-w-[10rem] items-center gap-0.5 rounded-md px-2 py-1 text-meta',
                    active ? 'bg-chrome-hover text-text-primary' : 'text-text-muted chrome-hover-soft'
                  )}
                >
                  <button
                    type="button"
                    className="min-w-0 truncate font-mono"
                    onClick={() => setActiveTab(tab.filePath)}
                    title={tab.filePath}
                  >
                    {basenameFromPath(tab.filePath)}
                    {tabDirty ? ' •' : ''}
                  </button>
                  <button
                    type="button"
                    className="shrink-0 rounded p-0.5 chrome-hover-soft"
                    aria-label={`Close ${basenameFromPath(tab.filePath)}`}
                    onClick={() => {
                      closeTab(tab.filePath);
                      if (tabs.length <= 1) close();
                    }}
                  >
                    <X className="h-3 w-3" strokeWidth={SHELL_ACTION_ICON_STROKE} />
                  </button>
                </div>
              );
            })}
          </div>
        ) : null}
        {filePath ? (
          <p className="vx-editor-path shrink-0 truncate px-3 py-1.5 font-mono text-meta text-text-faint" title={filePath}>
            {filePath}
          </p>
        ) : null}
        {truncated ? (
          <p className="shrink-0 px-3 py-1 text-meta text-warning">
            File exceeds 512 KB — showing the first portion only.
          </p>
        ) : null}
        {staleOnDisk ? (
          <div className="vx-editor-stale-banner flex shrink-0 items-center justify-between gap-2 px-3 py-1.5 text-meta">
            <span>Agent or another process changed this file on disk.</span>
            <Button variant="link" size="sm" onClick={() => void reloadFromDisk()}>
              Reload
            </Button>
          </div>
        ) : null}
        {loading ? (
          <LoadingHint message="Loading file…" className="py-6" />
        ) : filePath ? (
          <CodeEditor
            value={content}
            filePath={filePath}
            onChange={setContent}
            onSave={() => void save()}
            inlineCompletion={inlineCompletion}
            onGoToDefinition={lsp.goToDefinition}
            lspBridge={lsp.bridge}
          />
        ) : null}
      </div>
    </FloatingPanel>
  );
}
