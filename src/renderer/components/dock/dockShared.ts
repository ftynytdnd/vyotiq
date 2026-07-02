/** Shared constants and class strings for the left navigation dock. */

import { useDockSearchStore } from '../../store/useDockSearchStore.js';
import { useDockSchedulesStore } from '../../store/useDockSchedulesStore.js';
import { useWorkspaceLauncherStore } from '../../store/useWorkspaceLauncherStore.js';
import { useUiStore } from '../../store/useUiStore.js';
import { useWorkspaceStore } from '../../store/useWorkspaceStore.js';
import { useConversationsStore } from '../../store/useConversationsStore.js';
import { cn } from '../../lib/cn.js';
import {
  SHELL_DOCK_TAB_ICON_CLASS,
  SHELL_TAB_ICON_STROKE
} from '../../lib/shellIcons.js';

export const CONV_DRAG_MIME = 'application/x-vyotiq-conversation';
export const EDITOR_TAB_DRAG_MIME = 'application/x-vyotiq-editor-tab';

/**
 * Hover-only dock actions. Hidden from layout until hover or keyboard focus
 * so tab labels can use the full row width (audit #20).
 */
export const DOCK_HOVER_ACTIONS =
  'hidden shrink-0 items-center group-hover:flex focus-within:flex';

/** Lucide icon sizing — matches Vyotiq UI {@link vx-tab}. */
export const DOCK_TAB_ICON_CLASS = SHELL_DOCK_TAB_ICON_CLASS;
export const DOCK_TAB_ICON_STROKE = SHELL_TAB_ICON_STROKE;

/** Primary label inside a dock tab row. */
export const DOCK_TAB_LABEL_CLASS = 'vx-dock-tab-label';

/** Inner activate control — inherits row color/typography; label ellipsis via {@link DOCK_TAB_LABEL_CLASS}. */
export const DOCK_TAB_TRIGGER_CLASS = 'vx-dock-tab-trigger';

const DOCK_TAB_ROW_CLASS = cn('vx-dock-tab group app-no-drag shrink-0');

export {
  clampDockWidth,
  dockMainPaddingLeft,
  DOCK_STRIP_WIDTH,
  DOCK_WIDTH_DEFAULT,
  DOCK_WIDTH_MAX
} from '@shared/dock/dockWidth.js';

export const DOCK_INSET_CLASS = 'flex min-h-0 flex-1 flex-col gap-1 px-1.5';

/** Empty / loading copy — icon + muted text, no background box. */
export const DOCK_EMPTY_STATE_CLASS =
  'mx-2 flex flex-col items-start gap-1.5 px-1 py-2 text-row text-text-muted';

export function dockInlineActionClassName(): string {
  return cn('vx-btn vx-btn-quiet px-2 text-row');
}

export const DOCK_RESIZE_HANDLE_CLASS =
  'vx-dock-resize-handle absolute inset-y-0 right-0 z-10 w-1.5 cursor-col-resize';

export const DOCK_EDGE_CONTAINER_CLASS = cn(
  'absolute left-0 top-0 bottom-0 z-(--z-dock-rail) flex min-h-0'
);

export function dockFlyoutShellClassName(isResizing: boolean): string {
  return cn(
    'vx-dock-shell vx-dock-panel app-no-drag',
    'mt-[var(--titlebar-h)] flex min-h-0 max-h-[calc(100%-var(--titlebar-h))] flex-1 flex-col overflow-hidden',
    isResizing ? '' : 'transition-[width] duration-200 ease-out'
  );
}

export function workspacePanelClassName(workspaceCount: number): string {
  if (workspaceCount <= 2) {
    return 'flex shrink-0 flex-col overflow-hidden';
  }
  return 'flex max-h-[9.5rem] min-h-0 shrink-0 flex-col overflow-hidden';
}

/** Show filesystem path under workspace label when it adds information. */
export function workspacePathVisible(label: string, path: string): boolean {
  if (!path.trim()) return false;
  const normalized = path.trim().replace(/[\\/]+$/, '');
  const segments = normalized.split(/[\\/]/);
  const base = segments[segments.length - 1] ?? '';
  return base.toLowerCase() !== label.trim().toLowerCase();
}

/** Flat region for the active workspace files/chats panel (no card chrome). */
export const DOCK_WORKSPACE_PANEL_SHELL_CLASS = 'vx-dock-workspace-region';

export type DockPanelTab = 'files' | 'chats';

/** Open inline search after picking a workspace or chat. */
export function dismissDockSearchAfterSelection(): void {
  useDockSearchStore.getState().setOpen(false);
}

/** Expand the nav panel and show chats before starting a new conversation. */
export function prepareDockForNewChat(): void {
  const ui = useUiStore.getState();
  ui.setDockExpanded(true);
  const activeId = useWorkspaceStore.getState().activeId;
  if (activeId) ui.setWorkspaceFilesExpanded(activeId, false);
}

/** When the nav panel is open, show chats after a conversation is created in the background. */
export function showDockChatsWhenExpanded(): void {
  const ui = useUiStore.getState();
  if (!ui.dockExpanded) return;
  const activeId = useWorkspaceStore.getState().activeId;
  if (activeId) ui.setWorkspaceFilesExpanded(activeId, false);
}

/** Rail / menu / shortcut entry — expand nav, create chat, select it, show Chats tab. */
export async function beginNewChatFromDock(): Promise<void> {
  prepareDockForNewChat();
  const convs = useConversationsStore.getState();
  const meta = await convs.newConversation();
  if (!meta) return;
  const activeId = useWorkspaceStore.getState().activeId;
  if (activeId) useUiStore.getState().setWorkspaceFilesExpanded(activeId, false);
  await convs.select(meta.id);
}

/** Active chat tab — stacks title row + context meter. */
export const DOCK_CHAT_TAB_STACK_CLASS = 'flex flex-col gap-0';

/** Inner title/actions row inside a chat tab. */
export const DOCK_CHAT_TAB_INNER_CLASS = cn(
  'flex w-full min-w-0 items-center gap-1'
);

/** Base row class for dock tabs; pair with {@link dockTabActiveAttr} for selection styling. */
export function dockTabRowClassName(): string {
  return DOCK_TAB_ROW_CLASS;
}

/** `data-active` attribute value for {@link dockTabRowClassName} rows. */
export function dockTabActiveAttr(active: boolean): 'true' | 'false' {
  return active ? 'true' : 'false';
}

/** Expand dock and focus the workspace navigator. */
export function openDockNavigator(): void {
  useUiStore.getState().setDockExpanded(true);
}

/** Expand dock with the files tree for a workspace. */
export function openDockFiles(workspaceId: string): void {
  const ui = useUiStore.getState();
  ui.setDockExpanded(true);
  ui.setDockPanelTab('files');
  ui.setWorkspaceFilesExpanded(workspaceId, true);
}

/** Expand dock with the chats list for a workspace. */
export function openDockChats(workspaceId: string): void {
  const ui = useUiStore.getState();
  ui.setDockExpanded(true);
  ui.setDockPanelTab('chats');
  ui.setWorkspaceFilesExpanded(workspaceId, false);
}

/** Close inline search, or collapse the nav panel when Escape is pressed. */
export function dismissDockFlyout(): void {
  const launcher = useWorkspaceLauncherStore.getState();
  if (launcher.open && launcher.placement === 'inline') {
    launcher.setOpen(false);
    return;
  }
  const search = useDockSearchStore.getState();
  if (search.open) {
    search.setOpen(false);
    return;
  }
  const schedules = useDockSchedulesStore.getState();
  if (schedules.open) {
    schedules.setOpen(false);
    return;
  }
  useUiStore.getState().setDockExpanded(false);
}
