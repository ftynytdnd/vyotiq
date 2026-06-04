/**
 * `useCopyFeedback` — the shared "Copy → brief ✓ → reset" affordance
 * behind every copy button in the renderer (code blocks, assistant /
 * user rows, markdown fences, diff cards).
 *
 * Each call site previously hand-rolled the exact same trio:
 *   - a `copied` boolean,
 *   - a `setTimeout` ref that resets it after a beat, and
 *   - a `mounted` ref + unmount cleanup so a fast unmount can't leak
 *     the timer or call `setState` on a torn-down component.
 *
 * Folding it here removes that duplication and guarantees the
 * zero-leak cleanup is applied uniformly — an always-on desktop agent
 * mounts and tears down these rows constantly as the timeline scrolls.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { safeCopy } from '../lib/clipboard.js';

/** Duration the post-copy ✓ confirmation stays lit, in milliseconds. */
const COPY_FEEDBACK_MS = 1200;

export interface UseCopyFeedback {
  /** `true` while the post-copy confirmation is showing. */
  copied: boolean;
  /**
   * Write `text` via the shared `safeCopy` helper and, on success,
   * light the `copied` flag for `resetMs`. Returns the `safeCopy`
   * result so callers can branch on failure if needed.
   */
  copy: (
    text: string,
    opts?: { context?: string; toastOnFailure?: boolean }
  ) => Promise<boolean>;
  /**
   * Light the confirmation directly — for call sites that perform (or
   * await) the clipboard write themselves and only want the timed ✓.
   * No-op after unmount.
   */
  flag: () => void;
}

export function useCopyFeedback(): UseCopyFeedback {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, []);

  const flag = useCallback(() => {
    if (!mountedRef.current) return;
    setCopied(true);
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      if (mountedRef.current) setCopied(false);
    }, COPY_FEEDBACK_MS);
  }, []);

  const copy = useCallback(
    async (
      text: string,
      opts?: { context?: string; toastOnFailure?: boolean }
    ): Promise<boolean> => {
      const ok = await safeCopy(text, opts);
      if (ok) flag();
      return ok;
    },
    [flag]
  );

  return { copied, copy, flag };
}
