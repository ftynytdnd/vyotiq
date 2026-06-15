/**
 * Keep-alive CodeMirror instances — one per open editor tab.
 */

import { useMemo } from 'react';
import {
  resolveCompletionModelSelection,
  resolveInlineCompletionSettings
} from '@shared/settings/inlineCompletionSettings.js';
import type { ModelSelection } from '@shared/types/provider.js';
import { CodeEditor } from '../editor/CodeEditor.js';
import {
  selectActiveEditorTab,
  useEditorStore,
  type EditorTab
} from '../../store/useEditorStore.js';
import { useSettingsStore } from '../../store/useSettingsStore.js';
import { useWorkspaceStore } from '../../store/useWorkspaceStore.js';
import { useEditorLsp } from '../../hooks/useEditorLsp.js';
import { normalizePath } from '../../lib/normalizePath.js';
import { cn } from '../../lib/cn.js';

function EditorTabPane({
  tab,
  active,
  inlineCompletionEnabled,
  onGoToDefinition,
  lspBridge,
  onChange,
  onSave,
  onCursor
}: {
  tab: EditorTab;
  active: boolean;
  inlineCompletionEnabled: boolean;
  onGoToDefinition: (line: number, character: number) => void;
  lspBridge: ReturnType<typeof useEditorLsp>['bridge'];
  onChange: (filePath: string, value: string) => void;
  onSave: (filePath: string) => void;
  onCursor: (line: number, col: number, selection: number) => void;
}) {
  const settings = useSettingsStore((s) => s.settings);
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeId);

  const inlineCompletion = useMemo(() => {
    const ic = resolveInlineCompletionSettings(settings.ui);
    if (
      !inlineCompletionEnabled ||
      !ic.enabled ||
      !ic.editorEnabled ||
      !tab.filePath ||
      !tab.workspaceId
    ) {
      return null;
    }
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
      filePath: tab.filePath,
      workspaceId: tab.workspaceId
    };
  }, [activeWorkspaceId, inlineCompletionEnabled, settings.defaultModel, settings.ui, tab.filePath, tab.workspaceId]);

  const bridge = active ? lspBridge : null;
  const goToDef = active ? onGoToDefinition : undefined;

  return (
    <div
      className={cn(
        'absolute inset-0 flex min-h-0 flex-col',
        !active && 'pointer-events-none invisible'
      )}
      aria-hidden={!active}
    >
      <CodeEditor
        value={tab.content}
        filePath={tab.filePath}
        active={active}
        readOnly={tab.agentStreaming === true || tab.staleOnDisk}
        onChange={(v) => onChange(tab.filePath, v)}
        onSave={() => onSave(tab.filePath)}
        onCursor={active ? onCursor : undefined}
        inlineCompletion={active ? inlineCompletion : null}
        onGoToDefinition={goToDef}
        lspBridge={bridge}
      />
    </div>
  );
}

export interface EditorTabViewsProps {
  onGoToDefinition: (line: number, character: number) => void;
  lspBridge: ReturnType<typeof useEditorLsp>['bridge'];
  onCursor: (line: number, col: number, selection: number) => void;
}

export function EditorTabViews({ onGoToDefinition, lspBridge, onCursor }: EditorTabViewsProps) {
  const tabs = useEditorStore((s) => s.tabs);
  const activeTab = useEditorStore(selectActiveEditorTab);
  const activePath = activeTab?.filePath ?? null;
  const setContent = useEditorStore((s) => s.setContent);
  const save = useEditorStore((s) => s.save);

  const onChangeForTab = (filePath: string, value: string) => {
    const active = useEditorStore.getState().activeFilePath;
    if (active && normalizePath(active) === normalizePath(filePath)) {
      setContent(value);
    } else {
      useEditorStore.setState((state) => ({
        ...state,
        tabs: state.tabs.map((t) =>
          normalizePath(t.filePath) === normalizePath(filePath) ? { ...t, content: value } : t
        )
      }));
    }
  };

  const onSaveForTab = (filePath: string) => {
    const active = useEditorStore.getState().activeFilePath;
    if (active && normalizePath(active) === normalizePath(filePath)) {
      void save();
    }
  };

  return (
    <div className="relative min-h-0 flex-1">
      {tabs.map((tab) => (
        <EditorTabPane
          key={normalizePath(tab.filePath)}
          tab={tab}
          active={activePath !== null && normalizePath(tab.filePath) === normalizePath(activePath)}
          inlineCompletionEnabled
          onGoToDefinition={onGoToDefinition}
          lspBridge={lspBridge}
          onChange={onChangeForTab}
          onSave={onSaveForTab}
          onCursor={onCursor}
        />
      ))}
    </div>
  );
}
