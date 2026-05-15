/**
 * Prompt-history navigation for the composer.
 *
 * Derives a stable list of past user-prompt contents from the active
 * conversation's timeline events. The cursor is kept in a ref so
 * Up/Down arrows never force a React re-render — the composer reads
 * the recalled text synchronously and sets local state.
 *
 * Cursor semantics:
 *   - `reset()`  → cursor jumps to the tail (past the newest entry).
 *   - `recall('up')`   → move one step toward older prompts; return
 *     the prompt content at the new cursor position.
 *   - `recall('down')` → move one step toward newer prompts; return
 *     the prompt content, or `null` when the cursor is already at the
 *     tail (meaning "return to empty composer").
 *
 * The list is rebuilt whenever `events` changes identity (new event
 * appended, conversation switched, etc.).
 */

import { useMemo, useRef, useCallback } from 'react';
import type { TimelineEvent } from '@shared/types/chat.js';

export interface ComposerHistoryApi {
  /** Move the history cursor and return the prompt at the new position. */
  recall: (direction: 'up' | 'down') => string | null;
  /** Reset the cursor to the tail (newest). Call when the user types. */
  reset: () => void;
}

export function useComposerHistory(events: readonly TimelineEvent[]): ComposerHistoryApi {
  const history = useMemo(() => {
    const out: string[] = [];
    for (const e of events) {
      if (e.kind === 'user-prompt') {
        out.push(e.content);
      }
    }
    return out;
  }, [events]);

  // Cursor points at the *current* history index being recalled.
  // `history.length` means "no recall active — composer is empty or
  // user is typing fresh". Valid indices are 0 … history.length-1.
  const cursorRef = useRef<number>(history.length);

  // Keep cursor in bounds when the history list shrinks (e.g. after a
  // clear / new conversation).
  if (cursorRef.current > history.length) {
    cursorRef.current = history.length;
  }

  const recall = useCallback((direction: 'up' | 'down'): string | null => {
    if (history.length === 0) return null;

    if (direction === 'up') {
      const next = Math.max(0, cursorRef.current - 1);
      cursorRef.current = next;
      return history[next] ?? null;
    }

    // direction === 'down'
    const next = Math.min(history.length, cursorRef.current + 1);
    cursorRef.current = next;
    // When the cursor returns to the tail position, signal "empty".
    if (next >= history.length) return null;
    return history[next] ?? null;
  }, [history]);

  const reset = useCallback(() => {
    cursorRef.current = history.length;
  }, [history.length]);

  return { recall, reset };
}
