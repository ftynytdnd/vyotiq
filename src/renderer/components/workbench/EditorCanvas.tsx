/**
 * Editor canvas body — CodeMirror surface without workbench chrome.
 */

import { useMemo } from 'react';
import {
  resolveCompletionModelSelection,
  resolveInlineCompletionSettings
} from '@shared/settings/inlineCompletionSettings.js';
import type { ModelSelection } from '@shared/types/provider.js';
import { LoadingHint } from '../ui/LoadingHint.js';
import { Button } from '../ui/Button.js';
import { CodeEditor } from '../editor/CodeEditor.js';
import {
  selectActiveEditorTab,
  selectEditorDirty,
  useEditorStore
} from '../../store/useEditorStore.js';
import { useSettingsStore } from '../../store/useSettingsStore.js';
import { useWorkspaceStore } from '../../store/useWorkspaceStore.js';
import { useEditorLsp } from '../../hooks/useEditorLsp.js';
import { WORKBENCH_BODY_CLASS } from './workbenchShared.js';
import { cn } from '../../lib/cn.js';

export function EditorCanvas() {
  const activeTab = useEditorStore(selectActiveEditorTab);
  const filePath = activeTab?.filePath ?? null;
  const workspaceId = activeTab?.workspaceId ?? null;
  const content = activeTab?.content ?? '';
  const loading = activeTab?.loading ?? false;
  const truncated = activeTab?.truncated ?? false;
  const staleOnDisk = activeTab?.staleOnDisk ?? false;
  const dirty = useEditorStore(selectEditorDirty);
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

  return (
    <div className={cn(WORKBENCH_BODY_CLASS, 'vx-editor-canvas')}>
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
      {filePath && dirty ? (
        <p className="sr-only" aria-live="polite">
          Unsaved changes
        </p>
      ) : null}
    </div>
  );
}
