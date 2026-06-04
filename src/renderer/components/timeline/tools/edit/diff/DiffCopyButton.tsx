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

import { Check, Copy } from 'lucide-react';
import { chromeRevealIconActionClassName } from '../../../../ui/SurfaceShell.js';
import { cn } from '../../../../../lib/cn.js';
import { SHELL_ACTION_ICON_STROKE, SHELL_ROW_ICON_CLASS } from '../../../../../lib/shellIcons.js';
import { useCopyFeedback } from '../../../../../hooks/useCopyFeedback.js';

interface DiffCopyButtonProps {
  text: string;
  /** Visible when the user hovers the parent group with class
   *  `group/diff`. Pass an explicit class to override the default
   *  positioning when used outside the standard top-right slot. */
  className?: string;
}

export function DiffCopyButton({ text, className }: DiffCopyButtonProps) {
  const { copied: done, copy } = useCopyFeedback();

  const onCopy = (): void => {
    void copy(text, { context: 'diff-patch' });
  };

  return (
    <button
      type="button"
      onClick={onCopy}
      title={done ? 'Copied' : 'Copy diff'}
      aria-label={done ? 'Copied' : 'Copy diff'}
      className={cn(
        chromeRevealIconActionClassName('absolute right-1.5 top-1.5 z-10 group-hover/diff:opacity-100'),
        'hover:text-text-secondary',
        className
      )}
    >
      {done
        ? <Check className={SHELL_ROW_ICON_CLASS} strokeWidth={SHELL_ACTION_ICON_STROKE} />
        : <Copy className={SHELL_ROW_ICON_CLASS} strokeWidth={SHELL_ACTION_ICON_STROKE} />}
    </button>
  );
}
