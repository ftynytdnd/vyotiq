/**
 * Blocking progress modal for vector re-index operations.
 */

import { useEffect, useRef, useState } from 'react';
import { vyotiq } from '../../lib/ipc.js';
import { bindFocusTrap, focusFirstFocusable } from '../../lib/focusTrap.js';
import { LoadingHint } from '../ui/LoadingHint.js';
import { Button } from '../ui/Button.js';

export interface VectorReindexProgress {
  phase: 'start' | 'workspace' | 'done' | 'error';
  workspaceId?: string;
  workspaceLabel?: string;
  index?: number;
  total?: number;
  message?: string;
}

export function VectorReindexModal() {
  const [open, setOpen] = useState(false);
  const [lines, setLines] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const closeTimerRef = useRef<number | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    return () => {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    };
  }, []);

  useEffect(() => {
    return vyotiq.memory.onReindexProgress((progress: VectorReindexProgress) => {
      if (progress.phase === 'start') {
        setOpen(true);
        setError(null);
        setLines(['Starting vector re-index…']);
        return;
      }
      if (progress.phase === 'workspace') {
        const label = progress.workspaceLabel ?? progress.workspaceId ?? 'workspace';
        setLines((prev) => [
          ...prev,
          `Re-indexing ${label} (${progress.index ?? '?'}/${progress.total ?? '?'})…`
        ]);
        return;
      }
      if (progress.phase === 'error') {
        setError(progress.message ?? 'Re-index failed');
        return;
      }
      if (progress.phase === 'done') {
        setLines((prev) => [...prev, 'Re-index complete.']);
        if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
        closeTimerRef.current = window.setTimeout(() => {
          closeTimerRef.current = null;
          setOpen(false);
        }, 600);
      }
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    const raf = requestAnimationFrame(() => {
      const root = panelRef.current;
      if (root) focusFirstFocusable(root);
    });
    return () => cancelAnimationFrame(raf);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    return bindFocusTrap({
      getRoot: () => panelRef.current,
      disableEscape: true
    });
  }, [open]);

  if (!open) return null;

  return (
    <div
      ref={dialogRef}
      className="fixed inset-0 z-(--z-overlay-confirm) flex items-center justify-center bg-scrim p-4"
      role="dialog"
      aria-modal
      aria-label="Vector re-index"
    >
      <div
        ref={panelRef}
        className="w-full max-w-md rounded-lg border border-border-subtle bg-surface-raised p-4 shadow-modal"
      >
        <h2 className="vx-panel-title">Vector re-index</h2>
        <div className="vx-caption mt-3 max-h-48 space-y-1 overflow-y-auto text-text-secondary">
          {lines.map((line, i) => (
            <p key={`${i}-${line}`}>{line}</p>
          ))}
          {!error ? <LoadingHint message="Working…" className="py-2" /> : null}
          {error ? <p className="text-danger">{error}</p> : null}
        </div>
        {error ? (
          <Button variant="secondary" size="sm" className="mt-4" onClick={() => setOpen(false)}>
            Dismiss
          </Button>
        ) : null}
      </div>
    </div>
  );
}
