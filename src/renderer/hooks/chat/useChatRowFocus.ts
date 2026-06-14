/**
 * Chat row focus registry — conversation tabs in the left dock register
 * their DOM element so cross-component callers (e.g. RunningElsewhereHint)
 * can expand the dock and scroll the row into view.
 */

import { useEffect, useRef } from 'react';
import { useUiStore } from '../../store/useUiStore.js';
import { useWorkspaceStore } from '../../store/useWorkspaceStore.js';
import { useConversationsStore } from '../../store/useConversationsStore.js';

const registry = new Map<string, HTMLElement>();

export function useChatRowFocus(id: string): (el: HTMLElement | null) => void {
  const lastRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    return () => {
      const el = lastRef.current;
      if (el && registry.get(id) === el) registry.delete(id);
      lastRef.current = null;
    };
  }, [id]);

  return (el: HTMLElement | null) => {
    const prev = lastRef.current;
    if (prev && prev !== el && registry.get(id) === prev) {
      registry.delete(id);
    }
    if (el) {
      registry.set(id, el);
      lastRef.current = el;
    } else {
      lastRef.current = null;
    }
  };
}

function scrollRowIntoView(id: string): boolean {
  const el = registry.get(id);
  if (!el) return false;
  try {
    el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  } catch {
    /* happy-dom */
  }
  return true;
}

function deferScrollRowIntoView(id: string, frames = 2): void {
  let remaining = frames;
  const tick = () => {
    remaining -= 1;
    if (remaining <= 0) {
      scrollRowIntoView(id);
      return;
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

async function prepareRowNavigation(id: string): Promise<void> {
  const convs = useConversationsStore.getState();
  const meta = convs.list.find((c) => c.id === id);
  if (!meta?.workspaceId) return;

  const workspaceId = meta.workspaceId;
  useUiStore.getState().clearWorkspaceCollapsed(workspaceId);

  const activeWs = useWorkspaceStore.getState().activeId;
  if (activeWs !== workspaceId) {
    await useWorkspaceStore.getState().setActive(workspaceId);
  }

  const activeConv = convs.activeIdByWorkspace[workspaceId] ?? null;
  if (activeConv !== id) {
    await convs.select(id);
  }
}

export function focusRow(id: string): boolean {
  const ui = useUiStore.getState();
  ui.setDockExpanded(true);
  ui.setDockPanelTab('chats');

  void prepareRowNavigation(id).then(() => {
    deferScrollRowIntoView(id, 3);
  });

  return true;
}

export function __resetChatRowRegistry(): void {
  registry.clear();
}
