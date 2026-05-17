/**
 * Compact workflow controls for a sub-agent row.
 *
 * Kept separate from `SubAgentTrace` so the row can stay focused on hierarchy
 * while the button state, clipboard timer, and open-file workflow remain
 * isolated and easy to audit for leaks.
 */

import {
  useEffect,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode
} from 'react';
import { Check, Copy, FileCode, Maximize2 } from 'lucide-react';
import { stripEmoji } from '@shared/text/emoji.js';
import { cn } from '../../../lib/cn.js';
import { safeCopy } from '../../../lib/clipboard.js';
import { openWorkspaceFile } from '../../../lib/openPath.js';
import { useWorkspaceStore } from '../../../store/useWorkspaceStore.js';

interface SubAgentActionsProps {
  output?: string;
  touchedFiles: string[];
  className?: string;
  /**
   * Optional Focus-mode trigger. When supplied, a Focus button is
   * rendered alongside the copy/open affordances. `Modal` restores
   * focus to whichever element was the document's active element
   * at open time (this button, in practice), so no caller-supplied
   * ref is needed.
   */
  onFocus?: () => void;
}

export function SubAgentActions({
  output,
  touchedFiles,
  className,
  onFocus
}: SubAgentActionsProps) {
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeId);
  const [copied, setCopied] = useState(false);
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

  const cleanOutput = output?.trim() ?? '';
  const canCopy = cleanOutput.length > 0;
  const firstTouchedFile = touchedFiles[0];
  const canFocus = typeof onFocus === 'function';

  if (!canCopy && !firstTouchedFile && !canFocus) return null;

  const onCopy = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (!canCopy) return;
    void safeCopy(stripEmoji(cleanOutput), { context: 'sub-agent-result' }).then(
      (ok) => {
        if (!ok || !mountedRef.current) return;
        setCopied(true);
        if (resetTimerRef.current !== null) clearTimeout(resetTimerRef.current);
        resetTimerRef.current = setTimeout(() => {
          if (!mountedRef.current) return;
          resetTimerRef.current = null;
          setCopied(false);
        }, 1200);
      }
    );
  };

  const onOpenFile = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (!firstTouchedFile) return;
    void openWorkspaceFile(firstTouchedFile, {
      ...(activeWorkspaceId ? { workspaceId: activeWorkspaceId } : {}),
      context: 'sub-agent'
    });
  };

  const openTitle =
    touchedFiles.length > 1
      ? `Open ${firstTouchedFile} (${touchedFiles.length} touched files)`
      : `Open ${firstTouchedFile}`;

  return (
    <div className={cn('flex shrink-0 items-center gap-1', className)}>
      {canCopy && (
        <IconAction
          title={copied ? 'Copied result' : 'Copy result'}
          onClick={onCopy}
        >
          {copied ? (
            <Check className="h-3.5 w-3.5 text-success" strokeWidth={2.25} />
          ) : (
            <Copy className="h-3.5 w-3.5" strokeWidth={2.25} />
          )}
        </IconAction>
      )}
      {firstTouchedFile && (
        <IconAction title={openTitle} onClick={onOpenFile}>
          <FileCode className="h-3.5 w-3.5" strokeWidth={2.25} />
        </IconAction>
      )}
      {canFocus && (
        <IconAction
          title="Open in focus mode"
          onClick={(event) => {
            event.stopPropagation();
            onFocus?.();
          }}
        >
          <Maximize2 className="h-3.5 w-3.5" strokeWidth={2.25} />
        </IconAction>
      )}
    </div>
  );
}

function IconAction({
  title,
  onClick,
  children
}: {
  title: string;
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={title}
      title={title}
      onClick={onClick}
      className={cn(
        'app-no-drag inline-flex h-6 w-6 items-center justify-center rounded-inner',
        'text-text-faint transition-colors duration-150',
        'hover:bg-surface-hover hover:text-text-primary'
      )}
    >
      {children}
    </button>
  );
}
