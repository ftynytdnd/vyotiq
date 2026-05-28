/**
 * Workspace file picker — body of the composer's `+` attachment popover.
 *
 * Positioning, outside-click, Escape, and resize/scroll re-anchoring all
 * live on the host (`AttachmentButton` via the `Popover` portal
 * primitive). This component owns only:
 *   - workspace-tree loading (cached) and live substring filtering
 *   - the filter input (or a breadcrumb in `@`-mention controlled mode)
 *   - the result list rendering and pick dispatch
 *
 * Surface palette stays aligned with `PermissionsMenu` and `Dropdown`.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { File, Folder, X } from 'lucide-react';
import { chromePopoverPanelClassName } from '../ui/SurfaceShell.js';
import { cn } from '../../lib/cn.js';
import { Eyebrow } from '../ui/Eyebrow.js';
import { TextField } from '../ui/TextField.js';
import { getWorkspaceTree } from '../../lib/workspaceTreeCache.js';
import { useWorkspaceStore } from '../../store/useWorkspaceStore.js';
import { useChatStore } from '../../store/useChatStore.js';
import { useConversationsStore } from '../../store/useConversationsStore.js';

interface AttachmentPickerProps {
  open: boolean;
  /** Closes the host popover after a pick. */
  onClose: () => void;
  /** Already-attached paths so the picker can disable them. */
  selected: string[];
  /** Called when the user picks one. */
  onPick: (path: string) => void;
  /**
   * When set, the filter input becomes controlled — the parent owns the
   * value and is notified on every change. Used by the Composer's
   * `@`-mention trigger so the textarea token and the picker filter stay
   * in lockstep. When undefined, the picker manages its own filter
   * internally (the original `+`-button flow).
   */
  controlledFilter?: string;
  onControlledFilterChange?: (next: string) => void;
}

const MAX_VISIBLE = 80;

export function AttachmentPicker({
  open,
  onClose,
  selected,
  onPick,
  controlledFilter,
  onControlledFilterChange
}: AttachmentPickerProps) {
  const [tree, setTree] = useState<string[] | null>(null);
  const [truncation, setTruncation] = useState<{ truncated: boolean; total: number }>({
    truncated: false,
    total: 0
  });
  const [loading, setLoading] = useState(false);
  const [internalFilter, setInternalFilter] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const conversationId = useChatStore((s) => s.conversationId);
  const convWorkspaceId = useConversationsStore((s) => {
    if (!conversationId) return null;
    return s.list.find((m) => m.id === conversationId)?.workspaceId ?? null;
  });
  const workspacePath = useWorkspaceStore((s) => {
    const wsId = convWorkspaceId ?? s.activeId;
    const entry = wsId ? s.list.find((w) => w.id === wsId) : undefined;
    return entry?.path ?? s.info.path ?? '';
  });
  const workspaceIdForTree = convWorkspaceId ?? useWorkspaceStore.getState().activeId ?? undefined;

  const isControlled = controlledFilter !== undefined;
  const filter = isControlled ? controlledFilter! : internalFilter;
  const setFilter = (next: string) => {
    if (isControlled) {
      onControlledFilterChange?.(next);
    } else {
      setInternalFilter(next);
    }
  };

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    // Reset only the *internal* filter on open. When the parent is
    // driving (controlled mode), it has already established the value
    // matching what the user typed after `@`.
    if (!isControlled) setInternalFilter('');
    // Tree is loaded through the renderer-side cache so re-opening the
    // picker (very common: `+` button + every `@` mention) reuses the
    // last fresh result instead of re-paying for a full `fast-glob`
    // walk on every click. Cache is invalidated on workspace switch.
    void getWorkspaceTree(workspacePath, 5, workspaceIdForTree ?? undefined)
      .then((result) => {
        if (cancelled) return;
        setTree(result.entries);
        setTruncation({ truncated: result.truncated, total: result.total });
      })
      .catch(() => {
        if (!cancelled) {
          setTree([]);
          setTruncation({ truncated: false, total: 0 });
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    // Don't steal focus when the parent is driving the filter (the
    // textarea must keep focus so the user can keep typing the @-token).
    const raf = isControlled
      ? null
      : requestAnimationFrame(() => inputRef.current?.focus());
    return () => {
      cancelled = true;
      if (raf !== null) cancelAnimationFrame(raf);
    };
  }, [open, isControlled, workspacePath, workspaceIdForTree]);

  const filtered = useMemo(() => {
    const all = tree ?? [];
    const q = filter.trim().toLowerCase();
    const list = q.length === 0 ? all : all.filter((p) => p.toLowerCase().includes(q));
    return list.slice(0, MAX_VISIBLE);
  }, [tree, filter]);

  if (!open) return null;

  return (
    <div
      className={cn(chromePopoverPanelClassName, 'w-80 p-1.5')}
    >
      {isControlled ? (
        // In `@`-mention mode, the filter is driven by the textarea — show
        // a non-interactive breadcrumb instead of a second input.
        <Eyebrow className="px-2 pb-1.5">
          Mention {filter ? <span className="font-mono normal-case text-text-muted">@{filter}</span> : '@…'}
        </Eyebrow>
      ) : (
        <div className="px-1 pb-1.5">
          <TextField
            ref={inputRef}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter files…"
            size="sm"
            tone="base"
            className="w-full"
          />
        </div>
      )}
      <div className="max-h-72 overflow-y-auto" aria-live="polite">
        {loading && (
          <div className="px-2 py-2 text-row text-text-muted">Loading workspace…</div>
        )}
        {!loading && filtered.length === 0 && (
          <div className="px-2 py-2 text-row text-text-muted">
            {tree && tree.length === 0
              ? 'Pick a workspace first.'
              : 'No matches.'}
          </div>
        )}
        {!loading &&
          filtered.map((path) => {
            const isDir = path.endsWith('/');
            const cleaned = isDir ? path.slice(0, -1) : path;
            const isSelected = selected.includes(cleaned);
            return (
              <button
                key={path}
                type="button"
                disabled={isDir || isSelected}
                onClick={() => {
                  onPick(cleaned);
                  onClose();
                }}
                className={cn(
                  'flex w-full items-center gap-2 rounded-inner px-2 py-1 text-left text-row transition-colors duration-150',
                  'text-text-secondary hover:bg-surface-hover hover:text-text-primary',
                  (isDir || isSelected) && 'opacity-40 cursor-not-allowed hover:bg-transparent'
                )}
              >
                {isDir ? (
                  <Folder className="h-3.5 w-3.5 shrink-0 text-text-faint" strokeWidth={2} />
                ) : (
                  <File className="h-3.5 w-3.5 shrink-0 text-text-faint" strokeWidth={2} />
                )}
                <span className="truncate font-mono">{cleaned}</span>
                {isSelected && <X className="ml-auto h-3 w-3 text-text-faint" strokeWidth={2.25} />}
              </button>
            );
          })}
      </div>
      <div className="border-t border-border-subtle/30 px-2 pt-1.5 text-meta text-text-faint">
        Files only. Selected files are inlined into the agent's context.
      </div>
      {truncation.truncated && (
        <div className="px-2 pt-0.5 text-meta text-text-faint">
          Showing {filtered.length} of {truncation.total.toLocaleString()} entries —
          narrow the filter to reach the rest.
        </div>
      )}
    </div>
  );
}
