/**
 * Hover-revealed copy button placed in the diff card's top-right
 * corner. Used by `DiffViewer` to expose the full unified-diff
 * patch text on demand.
 *
 * Routes the write through the shared `safeCopy` helper so the
 * Clipboard-API + `document.execCommand` fallback + danger-toast on
 * failure paths are unified with the rest of the renderer's copy
 * affordances. Shows a brief checkmark when the write succeeds; the
 * success flag is reset via a single `setTimeout` that is always
 * cleared on unmount so a fast-unmount flow can't leak the timer or
 * call `setState` on a torn-down component.
 */

import { useEffect, useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { cn } from '../../../../../lib/cn.js';
import { safeCopy } from '../../../../../lib/clipboard.js';

interface DiffCopyButtonProps {
  text: string;
  /** Visible when the user hovers the parent group with class
   *  `group/diff`. Pass an explicit class to override the default
   *  positioning when used outside the standard top-right slot. */
  className?: string;
}

const COPY_FEEDBACK_MS = 1200;

export function DiffCopyButton({ text, className }: DiffCopyButtonProps) {
  const [done, setDone] = useState(false);
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      if (resetTimerRef.current !== null) {
        clearTimeout(resetTimerRef.current);
        resetTimerRef.current = null;
      }
    };
  }, []);

  const onCopy = async () => {
    const ok = await safeCopy(text, { context: 'diff-patch' });
    if (!ok || !mountedRef.current) return;
    setDone(true);
    if (resetTimerRef.current !== null) clearTimeout(resetTimerRef.current);
    resetTimerRef.current = setTimeout(() => {
      if (!mountedRef.current) return;
      resetTimerRef.current = null;
      setDone(false);
    }, COPY_FEEDBACK_MS);
  };

  return (
    <button
      type="button"
      onClick={onCopy}
      title={done ? 'Copied' : 'Copy diff'}
      aria-label={done ? 'Copied' : 'Copy diff'}
      className={cn(
        'absolute right-1.5 top-1.5 z-10 inline-flex h-6 w-6 items-center justify-center',
        'rounded-inner text-text-faint transition-opacity duration-150',
        'opacity-0 group-hover/diff:opacity-100 focus:opacity-100',
        'hover:bg-surface-hover hover:text-text-secondary',
        className
      )}
    >
      {done
        ? <Check className="h-3.5 w-3.5" strokeWidth={2.25} />
        : <Copy className="h-3.5 w-3.5" strokeWidth={2.25} />}
    </button>
  );
}
