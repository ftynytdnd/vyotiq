/**
 * Workbench shell — side pane with top tabs, contextual toolbar, canvas helpers.
 */

import { normalizePath } from '../../lib/normalizePath.js';
import { useAttachmentPreviewStore } from '../../store/useAttachmentPreviewStore.js';
import { useEditorStore } from '../../store/useEditorStore.js';
import { useTerminalStore } from '../../store/useTerminalStore.js';
import { useUiStore } from '../../store/useUiStore.js';
import { useWorkspaceStore } from '../../store/useWorkspaceStore.js';

/** Workbench pane tabs — agent chat stays in the left column. */
export type CompanionTab = 'editor' | 'terminal' | 'globe';

/** @deprecated Agent is no longer a workbench tab; kept for persisted UI migration. */
export type WorkbenchTab = 'agent' | CompanionTab;

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

export function workbenchIsActive(): boolean {
  const editorOpen = useEditorStore.getState().open;
  const terminalOpen = useTerminalStore.getState().open;
  const previewOpen = useAttachmentPreviewStore.getState().attachment !== null;
  return editorOpen || terminalOpen || previewOpen;
}

export function focusWorkbenchTab(tab: WorkbenchTab): void {
  useUiStore.getState().setWorkbenchTab(tab);
}

export function focusWorkbenchAgent(): void {
  focusWorkbenchTab('agent');
}

/** Pick the visible companion tab when `agent` is stored or the selection is stale. */
export function resolveCompanionTab(tab: WorkbenchTab): CompanionTab {
  if (tab === 'terminal' && useTerminalStore.getState().open) return 'terminal';
  if (tab === 'globe') return 'globe';
  if (tab === 'editor' && useEditorStore.getState().open) return 'editor';
  if (useTerminalStore.getState().open) return 'terminal';
  if (useEditorStore.getState().open) return 'editor';
  if (useAttachmentPreviewStore.getState().attachment !== null) return 'globe';
  return 'terminal';
}

/** Switch left dock to Files when opening editor content. */
export function focusDockFilesPanel(): void {
  useUiStore.getState().setDockPanelTab('files');
}

export function closeTerminalPanel(): void {
  useTerminalStore.getState().close();
}

export function closeGlobePanel(): void {
  useAttachmentPreviewStore.getState().close();
  syncWorkbenchTabAfterClose();
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
  const ui = useUiStore.getState();
  const tab = ui.workbenchTab;
  if (tab === 'terminal' && !useTerminalStore.getState().open) {
    focusWorkbenchTab(resolveCompanionTab('agent'));
    return;
  }
  if (tab === 'editor' && !useEditorStore.getState().open) {
    focusWorkbenchTab(resolveCompanionTab('agent'));
    return;
  }
  if (tab === 'globe' && useAttachmentPreviewStore.getState().attachment === null) {
    focusWorkbenchTab(resolveCompanionTab('agent'));
  }
}

export type WorkbenchFocusTarget = 'terminal' | 'globe' | { editor: string };

function workbenchFocusTargetKey(target: WorkbenchFocusTarget): string {
  return target === 'terminal' || target === 'globe' ? target : `editor:${normalizePath(target.editor)}`;
}

export function listWorkbenchFocusTargets(): WorkbenchFocusTarget[] {
  const targets: WorkbenchFocusTarget[] = ['terminal', 'globe'];
  for (const tab of useEditorStore.getState().tabs) {
    targets.push({ editor: tab.filePath });
  }
  return targets;
}

export function getActiveWorkbenchFocusTarget(): WorkbenchFocusTarget | null {
  if (!workbenchIsActive()) return null;
  const tab = resolveCompanionTab(useUiStore.getState().workbenchTab);
  if (tab === 'terminal') return 'terminal';
  if (tab === 'globe') return 'globe';
  const activeFile = useEditorStore.getState().activeFilePath;
  return activeFile ? { editor: activeFile } : 'terminal';
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
  if (target === 'globe') {
    focusWorkbenchTab('globe');
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
  if (tab === 'terminal' && useTerminalStore.getState().open) {
    closeTerminalPanel();
    return;
  }
  if (tab === 'globe') {
    if (useAttachmentPreviewStore.getState().attachment !== null) {
      closeGlobePanel();
      return;
    }
    focusWorkbenchTab(resolveCompanionTab('agent'));
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
