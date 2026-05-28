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
 * Surface palette stays aligned with `PermissionModePill` and `Dropdown`.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { File, Folder, X } from 'lucide-react';
import { chromeNoMatchesClassName, appPopoverPanelClassName } from '../ui/SurfaceShell.js';
import { cn } from '../../lib/cn.js';
import {
  SHELL_ACTION_ICON_STROKE,
  SHELL_ROW_ICON_CLASS
} from '../../lib/shellIcons.js';
import { Eyebrow } from '../ui/Eyebrow.js';
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
      className={cn(appPopoverPanelClassName, 'w-80 p-1.5')}
    >
      {isControlled ? (
        // In `@`-mention mode, the filter is driven by the textarea — show
        // a non-interactive breadcrumb instead of a second input.
        <Eyebrow className="px-2 pb-1.5">
          Mention {filter ? <span className="font-mono normal-case text-text-muted">@{filter}</span> : '@…'}
        </Eyebrow>
      ) : (
        <div className="px-1 pb-1.5">
          <input
            ref={inputRef}
            type="search"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter files…"
            className="vx-input w-full text-row"
          />
        </div>
      )}
      <div className="max-h-72 overflow-y-auto" aria-live="polite">
        {loading && (
          <div className={chromeNoMatchesClassName}>Loading workspace…</div>
        )}
        {!loading && filtered.length === 0 && (
          <div className={chromeNoMatchesClassName}>
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
                  'vx-dropdown-item flex w-full items-center gap-2',
                  (isDir || isSelected) && 'opacity-40 cursor-not-allowed hover:bg-transparent'
                )}
              >
                {isDir ? (
                  <Folder className={cn(SHELL_ROW_ICON_CLASS, 'text-text-faint')} strokeWidth={SHELL_ACTION_ICON_STROKE} />
                ) : (
                  <File className={cn(SHELL_ROW_ICON_CLASS, 'text-text-faint')} strokeWidth={SHELL_ACTION_ICON_STROKE} />
                )}
                <span className="truncate font-mono">{cleaned}</span>
                {isSelected && (
                  <X
                    className={cn(SHELL_ROW_ICON_CLASS, 'ml-auto text-text-faint')}
                    strokeWidth={SHELL_ACTION_ICON_STROKE}
                  />
                )}
              </button>
            );
          })}
      </div>
      <div className="px-2 pt-1.5 text-meta text-text-faint">
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
