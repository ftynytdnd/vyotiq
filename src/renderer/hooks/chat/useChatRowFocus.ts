/**
 * Chat row focus registry — conversation tabs in the bottom dock register
 * their DOM element so cross-component callers (e.g. RunningElsewhereHint)
 * can expand the dock and scroll the row into view.
 */

import { useEffect, useRef } from 'react';
import { useUiStore } from '../../store/useUiStore.js';

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
    el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  } catch {
    /* happy-dom */
  }
  return true;
}

export function focusRow(id: string): boolean {
  const expanded = useUiStore.getState().dockExpanded;
  if (!expanded) {
    useUiStore.getState().setDockExpanded(true);
    // DockChatStrip mounts on the next render — defer until refs register.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        scrollRowIntoView(id);
      });
    });
    return true;
  }
  return scrollRowIntoView(id);
}

export function __resetChatRowRegistry(): void {
  registry.clear();
}
