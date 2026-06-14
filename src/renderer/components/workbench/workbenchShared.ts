/**
 * Workbench shell — side pane with top tabs, contextual toolbar, canvas helpers.
 */

import { normalizePath } from '../../lib/normalizePath.js';
import { useAttachmentPreviewStore } from '../../store/useAttachmentPreviewStore.js';
import { useBrowserStore } from '../../store/useBrowserStore.js';
import { useEditorStore } from '../../store/useEditorStore.js';
import { useTerminalStore } from '../../store/useTerminalStore.js';
import { useUiStore } from '../../store/useUiStore.js';
import { useWorkspaceStore } from '../../store/useWorkspaceStore.js';

/** Workbench pane tabs — agent chat stays in the left column. */
export type CompanionTab = 'editor' | 'terminal' | 'browser' | 'preview';

/** @deprecated `agent`/`globe` retained only for persisted UI migration. */
export type WorkbenchTab = 'agent' | 'globe' | CompanionTab;

export const WORKBENCH_SHELL_CLASS =
  'vx-workbench flex min-h-0 w-full flex-1 flex-col overflow-hidden bg-surface-base';
export const WORKBENCH_SHELL_SPLIT_ROW_CLASS = 'vx-workbench--split-row';
export const WORKBENCH_BODY_CLASS = 'flex min-h-0 w-full flex-1 flex-col overflow-hidden';
export const WORKBENCH_AGENT_MAIN_CLASS =
  'vx-workbench-agent-main flex min-h-0 w-full flex-1 flex-col overflow-hidden';
export const WORKBENCH_PANE_CLASS =
  'vx-workbench-companion flex min-h-0 flex-col overflow-hidden border-l border-border-subtle/25 bg-surface-base';
export const WORKBENCH_RESIZE_HANDLE_CLASS =
  'vx-workbench-resize-handle relative z-10 w-1.5 shrink-0 cursor-col-resize';

function terminalOpen(): boolean {
  return useTerminalStore.getState().open;
}
function editorOpen(): boolean {
  return useEditorStore.getState().open;
}
function browserOpen(): boolean {
  return useBrowserStore.getState().open;
}
function previewOpen(): boolean {
  return useAttachmentPreviewStore.getState().attachment !== null;
}

export function workbenchIsActive(): boolean {
  return terminalOpen() || editorOpen() || browserOpen() || previewOpen();
}

export function focusWorkbenchTab(tab: WorkbenchTab): void {
  useUiStore.getState().setWorkbenchTab(tab);
}

export function focusWorkbenchAgent(): void {
  focusWorkbenchTab('agent');
}

/** Pick the first open companion when none/stale is stored. */
function firstOpenCompanion(): CompanionTab {
  if (terminalOpen()) return 'terminal';
  if (editorOpen()) return 'editor';
  if (browserOpen()) return 'browser';
  if (previewOpen()) return 'preview';
  return 'terminal';
}

/** Resolve the visible companion tab for a stored selection (handles staleness + legacy `globe`). */
export function resolveCompanionTab(tab: WorkbenchTab): CompanionTab {
  if (tab === 'terminal' && terminalOpen()) return 'terminal';
  if (tab === 'editor' && editorOpen()) return 'editor';
  if (tab === 'browser' && browserOpen()) return 'browser';
  if (tab === 'preview' && previewOpen()) return 'preview';
  // Legacy `globe` mapped onto whichever of browser/preview is open.
  if (tab === 'globe') {
    if (browserOpen()) return 'browser';
    if (previewOpen()) return 'preview';
  }
  return firstOpenCompanion();
}

/** Switch left dock to Files when opening editor content. */
export function focusDockFilesPanel(): void {
  useUiStore.getState().setDockPanelTab('files');
}

export function closeTerminalPanel(): void {
  useTerminalStore.getState().close();
}

export function closeBrowserPanel(): void {
  useBrowserStore.getState().close();
}

export function closePreviewPanel(): void {
  useAttachmentPreviewStore.getState().close();
}

export function closeEditorPanel(): void {
  useEditorStore.getState().close();
  syncWorkbenchTabAfterClose();
}

/** After closing a companion, focus another open companion or reset to agent. */
export function syncWorkbenchTabAfterClose(): void {
  if (!workbenchIsActive()) {
    focusWorkbenchAgent();
    return;
  }
  const tab = useUiStore.getState().workbenchTab;
  const stillValid =
    (tab === 'terminal' && terminalOpen()) ||
    (tab === 'editor' && editorOpen()) ||
    (tab === 'browser' && browserOpen()) ||
    (tab === 'preview' && previewOpen());
  if (!stillValid) {
    focusWorkbenchTab(firstOpenCompanion());
  }
}

export type WorkbenchFocusTarget = 'terminal' | 'browser' | 'preview' | { editor: string };

function workbenchFocusTargetKey(target: WorkbenchFocusTarget): string {
  return typeof target === 'string' ? target : `editor:${normalizePath(target.editor)}`;
}

/** On-demand focus targets — only currently-open surfaces are listed. */
export function listWorkbenchFocusTargets(): WorkbenchFocusTarget[] {
  const targets: WorkbenchFocusTarget[] = [];
  if (terminalOpen()) targets.push('terminal');
  if (browserOpen()) targets.push('browser');
  if (previewOpen()) targets.push('preview');
  for (const tab of useEditorStore.getState().tabs) {
    targets.push({ editor: tab.filePath });
  }
  return targets;
}

export function getActiveWorkbenchFocusTarget(): WorkbenchFocusTarget | null {
  if (!workbenchIsActive()) return null;
  const tab = resolveCompanionTab(useUiStore.getState().workbenchTab);
  if (tab === 'terminal') return 'terminal';
  if (tab === 'browser') return 'browser';
  if (tab === 'preview') return 'preview';
  const activeFile = useEditorStore.getState().activeFilePath;
  return activeFile ? { editor: activeFile } : firstOpenCompanion() === 'terminal' ? 'terminal' : null;
}

export function focusWorkbenchFocusTarget(target: WorkbenchFocusTarget): void {
  if (target === 'terminal') {
    const terminal = useTerminalStore.getState();
    const workspaceId = terminal.workspaceId ?? useWorkspaceStore.getState().activeId;
    if (!terminal.open && workspaceId) {
      void terminal.openPanel(workspaceId);
    } else {
      focusWorkbenchTab('terminal');
    }
    return;
  }
  if (target === 'browser') {
    focusWorkbenchTab('browser');
    return;
  }
  if (target === 'preview') {
    focusWorkbenchTab('preview');
    return;
  }
  useEditorStore.getState().setActiveTab(target.editor);
  focusWorkbenchTab('editor');
}

export function cycleWorkbenchFocus(direction: 'prev' | 'next'): void {
  if (!workbenchIsActive()) return;
  const targets = listWorkbenchFocusTargets();
  if (targets.length === 0) return;
  const active = getActiveWorkbenchFocusTarget();
  const activeKey = active ? workbenchFocusTargetKey(active) : null;
  let index = activeKey ? targets.findIndex((t) => workbenchFocusTargetKey(t) === activeKey) : -1;
  if (index < 0) index = 0;
  const nextIndex =
    direction === 'next'
      ? (index + 1) % targets.length
      : (index - 1 + targets.length) % targets.length;
  focusWorkbenchFocusTarget(targets[nextIndex]!);
}

export function closeActiveWorkbenchFocus(): void {
  if (!workbenchIsActive()) return;
  const tab = resolveCompanionTab(useUiStore.getState().workbenchTab);
  if (tab === 'terminal' && terminalOpen()) {
    closeTerminalPanel();
    return;
  }
  if (tab === 'browser' && browserOpen()) {
    closeBrowserPanel();
    return;
  }
  if (tab === 'preview' && previewOpen()) {
    closePreviewPanel();
    return;
  }
  if (tab === 'editor') {
    const activeFilePath = useEditorStore.getState().activeFilePath;
    if (!activeFilePath) {
      closeEditorPanel();
      return;
    }
    const id = normalizePath(activeFilePath);
    const tabs = useEditorStore.getState().tabs;
    const remaining = tabs.filter((t) => normalizePath(t.filePath) !== id);
    useEditorStore.getState().closeTab(activeFilePath);
    if (remaining.length === 0) {
      closeEditorPanel();
      return;
    }
    const next = remaining[remaining.length - 1]!;
    useEditorStore.getState().setActiveTab(next.filePath);
  }
}
