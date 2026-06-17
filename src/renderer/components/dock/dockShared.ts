/** Shared constants and class strings for the left navigation dock. */

import { useDockSearchStore } from '../../store/useDockSearchStore.js';
import { useUiStore } from '../../store/useUiStore.js';
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

export const DOCK_FOOTER_TOOLBAR_CLASS = 'px-1.5 py-0';

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

export const DOCK_EDGE_STRIP_CLASS = cn(
  'vx-dock-edge-strip vx-dock-shell app-no-drag',
  'flex w-11 shrink-0 flex-col items-center justify-start',
  'bg-surface-base pt-[var(--dock-strip-pt)] pb-2'
);

export function workspacePanelClassName(_workspaceCount: number): string {
  return 'flex max-h-[9.5rem] min-h-0 shrink-0 flex-col overflow-hidden';
}

/** Flat region for the active workspace files/chats panel (no card chrome). */
export const DOCK_WORKSPACE_PANEL_SHELL_CLASS = 'vx-dock-workspace-region';

/** Inner layout for the active workspace panel. */
export const DOCK_WORKSPACE_PANEL_CLASS = 'vx-dock-workspace-panel';

export type DockPanelTab = 'files' | 'chats';

/** Open inline search after picking a workspace or chat. */
export function dismissDockSearchAfterSelection(): void {
  useDockSearchStore.getState().setOpen(false);
}

/** Expand the nav panel and show chats before starting a new conversation. */
export function prepareDockForNewChat(): void {
  const ui = useUiStore.getState();
  ui.setDockExpanded(true);
  ui.setDockPanelTab('chats');
}

/** When the nav panel is open, show chats after a conversation is created in the background. */
export function showDockChatsWhenExpanded(): void {
  const ui = useUiStore.getState();
  if (ui.dockExpanded) ui.setDockPanelTab('chats');
}

/** Rail / menu / shortcut entry — expand nav, create chat, select it, show Chats tab. */
export async function beginNewChatFromDock(): Promise<void> {
  prepareDockForNewChat();
  const convs = useConversationsStore.getState();
  const meta = await convs.newConversation();
  if (!meta) return;
  useUiStore.getState().setDockPanelTab('chats');
  await convs.select(meta.id);
}

/** Active chat tab — stacks title row + context meter. */
export const DOCK_CHAT_TAB_STACK_CLASS = 'flex flex-col gap-0';

/** Inner title/actions row inside a chat tab. */
export const DOCK_CHAT_TAB_INNER_CLASS = cn(
  'flex w-full min-w-0 items-center gap-1'
);

export function dockTabRowClassName(
  _active: boolean,
  _kind: 'chat' | 'workspace'
): string {
  return DOCK_TAB_ROW_CLASS;
}

/** data-active attribute value for {@link dockTabRowClassName} rows. */
export function dockTabActiveAttr(active: boolean): 'true' | 'false' {
  return active ? 'true' : 'false';
}

/** Close inline search, or collapse the nav panel when Escape is pressed. */
export function dismissDockFlyout(): void {
  const search = useDockSearchStore.getState();
  if (search.open) {
    search.setOpen(false);
    return;
  }
  useUiStore.getState().setDockExpanded(false);
}
