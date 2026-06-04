/**
 * Tail-stick scroll tracking for streaming bodies (reasoning panels,
 * worker text). manual_only: never auto-scroll unless the user is
 * already at the tail.
 */

import { useEffect, useRef, type RefObject, type UIEvent } from 'react';

/** px from bottom within which tail-sticking stays engaged. */
export const SCROLL_TAIL_STICK_PX = 16;

export function useScrollTailStick(
  content: string,
  options: { active: boolean; expanded?: boolean }
): {
  bodyRef: RefObject<HTMLDivElement | null>;
  onBodyScroll: (e: UIEvent<HTMLDivElement>) => void;
} {
  const { active, expanded = true } = options;
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const stickRef = useRef(false);

  useEffect(() => {
    if (!expanded || !active) return;
    const el = bodyRef.current;
    if (!el) return;
    if (stickRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [content, active, expanded]);

  useEffect(() => {
    if (!expanded || !active) return;
    const el = bodyRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;

    const ro = new ResizeObserver(() => {
      if (stickRef.current) {
        el.scrollTop = el.scrollHeight;
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [active, expanded]);

  const onBodyScroll = (e: UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickRef.current = distance <= SCROLL_TAIL_STICK_PX;
  };

  return { bodyRef, onBodyScroll };
}
