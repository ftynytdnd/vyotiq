/**
 * Editor canvas body — CodeMirror surface without workbench chrome.
 */

import { LoadingHint } from '../ui/LoadingHint.js';
import { Button } from '../ui/Button.js';
import {
  selectActiveEditorTab,
  selectEditorDirty,
  useEditorStore
} from '../../store/useEditorStore.js';
import { useSettingsStore } from '../../store/useSettingsStore.js';
import { useWorkspaceStore } from '../../store/useWorkspaceStore.js';
import { useEditorLsp } from '../../hooks/useEditorLsp.js';
import { useEditorCursorStore } from '../../store/useEditorCursorStore.js';
import { useEditorDiskWatcher } from '../../hooks/useEditorDiskWatcher.js';
import { EditorStatusBar } from './EditorStatusBar.js';
import { EditorTabViews } from './EditorTabViews.js';
import { useAppViewStore } from '../../store/useAppViewStore.js';
import { resolveEditorLspSettings } from '@shared/settings/editorLspSettings.js';
import { WORKBENCH_BODY_CLASS } from './workbenchShared.js';
import { cn } from '../../lib/cn.js';

export function EditorCanvas() {
  const activeTab = useEditorStore(selectActiveEditorTab);
  const filePath = activeTab?.filePath ?? null;
  const workspaceId = activeTab?.workspaceId ?? null;
  const loading = activeTab?.loading ?? false;
  const truncated = activeTab?.truncated ?? false;
  const staleOnDisk = activeTab?.staleOnDisk ?? false;
  const eol = activeTab?.eol ?? 'lf';
  const encoding = activeTab?.encoding ?? 'utf-8';
  const utf8Bom = activeTab?.utf8Bom ?? false;
  const dirty = useEditorStore(selectEditorDirty);
  const setCursor = useEditorCursorStore((s) => s.setCursor);
  const reloadFromDisk = useEditorStore((s) => s.reloadFromDisk);
  const settings = useSettingsStore((s) => s.settings);
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeId);

  useEditorDiskWatcher();

  const openSettings = useAppViewStore((s) => s.openSettings);
  const lspSettings = resolveEditorLspSettings(settings.ui);
  const lsp = useEditorLsp({
    enabled: lspSettings.enabled,
    filePath,
    workspaceId: workspaceId ?? activeWorkspaceId
  });

  return (
    <div className={cn(WORKBENCH_BODY_CLASS, 'vx-editor-canvas')}>
      {truncated ? (
        <p className="shrink-0 px-3 py-1 text-meta text-warning">
          File exceeds 512 KB — showing the first portion only.
        </p>
      ) : null}
      {staleOnDisk ? (
        <div className="vx-editor-stale-banner flex shrink-0 items-center justify-between gap-2 px-3 py-1.5 text-meta">
          <span>Disk changed — reload to replace your buffer.</span>
          <Button variant="link" size="sm" onClick={() => void reloadFromDisk()}>
            Reload
          </Button>
        </div>
      ) : null}
      {activeTab?.agentStreaming ? (
        <div className="flex shrink-0 items-center gap-2 border-b border-border-subtle/20 bg-accent/5 px-3 py-1 text-meta text-text-secondary">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" aria-hidden />
          Agent editing…
        </div>
      ) : null}
      {loading ? (
        <LoadingHint message="Loading file…" className="py-6" />
      ) : filePath ? (
        <EditorTabViews
          onGoToDefinition={lsp.goToDefinition}
          lspBridge={lsp.bridge}
          onCursor={setCursor}
        />
      ) : null}
      {filePath && dirty ? (
        <p className="sr-only" aria-live="polite">
          Unsaved changes
        </p>
      ) : null}
      {filePath && !loading ? (
        <EditorStatusBar
          filePath={filePath}
          eol={eol}
          encoding={encoding}
          utf8Bom={utf8Bom}
          dirty={dirty}
          lspEnabled={lspSettings.enabled}
          lspStatus={lsp.status}
          onLspClick={() => openSettings('agent-behavior')}
        />
      ) : null}
    </div>
  );
}
