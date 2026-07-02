/**
 * Branch list popover for GitHub-bound workspaces.
 */

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { GitBranch, Loader2 } from 'lucide-react';
import type { GitHubBranch } from '@shared/types/github.js';
import { vyotiq } from '../../../lib/ipc.js';
import { useWorkspaceStore } from '../../../store/useWorkspaceStore.js';
import { formatBranchChipLabel } from '@shared/github/formatBranchSync.js';
import { useWorkspaceGitContext } from '../../../hooks/useWorkspaceGitStatus.js';
import { useGitHubSyncStore } from '../../../store/useGitHubSyncStore.js';
import { useToastStore } from '../../../store/useToastStore.js';
import { Popover } from '../../ui/Popover.js';
import { TextField } from '../../ui/TextField.js';
import { ComposerPickerRow } from '../picker/ComposerPickerRow.js';
import { ComposerPickerShell, ComposerPickerHead } from '../picker/ComposerPickerPanel.js';
import { ComposerPickerHints } from '../picker/ComposerPickerHints.js';
import { cn } from '../../../lib/cn.js';
import { SHELL_ROW_ICON_CLASS, SHELL_ROW_ICON_STROKE } from '../../../lib/shellIcons.js';
import { chromeNoMatchesClassName } from '../../ui/SurfaceShell.js';

interface BranchPickerPanelProps {
  workspaceId: string;
  onClose: () => void;
}

export function BranchPickerPanel({ workspaceId, onClose }: BranchPickerPanelProps) {
  const workspace = useWorkspaceStore((s) => s.list.find((w) => w.id === workspaceId));
  const refresh = useWorkspaceStore((s) => s.refresh);
  const binding = workspace?.github;
  const [branches, setBranches] = useState<GitHubBranch[]>([]);
  const [loading, setLoading] = useState(true);
  const [switching, setSwitching] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [focusedIdx, setFocusedIdx] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listRef.current?.focus();
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!binding) return;
    setLoading(true);
    void (async () => {
      try {
        const rows = await vyotiq.github.listBranches(
          binding.accountId,
          binding.owner,
          binding.repo
        );
        if (!cancelled) setBranches(rows);
      } catch (err) {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : String(err);
        useToastStore.getState().show(msg, 'danger');
        setBranches([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [binding]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return branches;
    return branches.filter((b) => b.name.toLowerCase().includes(q));
  }, [branches, query]);

  useEffect(() => {
    setFocusedIdx(0);
  }, [query]);

  useEffect(() => {
    if (loading || filtered.length === 0) return;
    const rows = listRef.current?.querySelectorAll('.vx-composer-picker-row');
    rows?.[focusedIdx]?.scrollIntoView({ block: 'nearest' });
  }, [focusedIdx, filtered.length, loading]);

  const moveActive = (delta: number) => {
    if (filtered.length === 0) return;
    setFocusedIdx((idx) => (idx + delta + filtered.length) % filtered.length);
  };

  const handleListKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      moveActive(1);
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      moveActive(-1);
      return;
    }
    if (e.key === 'Enter' && filtered[focusedIdx]) {
      e.preventDefault();
      void activate(filtered[focusedIdx]!.name);
    }
  };

  const activate = async (branchName: string) => {
    if (!binding || branchName === binding.branch) {
      onClose();
      return;
    }
    setSwitching(branchName);
    try {
      await vyotiq.workspace.switchBranch({ workspaceId, branch: branchName });
      await refresh();
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      useToastStore.getState().show(msg, 'danger');
    } finally {
      setSwitching(null);
    }
  };

  if (!binding) return null;

  return (
    <ComposerPickerShell
      listRef={listRef}
      listAriaLabel="Branches"
      listAriaBusy={loading}
      activeDescendantId={
        filtered[focusedIdx]
          ? `composer-picker-row-branch-picker-${filtered[focusedIdx]!.name}`
          : undefined
      }
      onListKeyDown={handleListKeyDown}
      listTabIndex={0}
      head={
        <ComposerPickerHead
          icon={<GitBranch className={SHELL_ROW_ICON_CLASS} strokeWidth={SHELL_ROW_ICON_STROKE} aria-hidden />}
          title={binding.branch}
          subtitle={`${binding.owner}/${binding.repo}`}
        />
      }
      foot={<ComposerPickerHints selectLabel="switch" />}
    >
      <div className="px-2 pb-1 pt-1">
        <TextField
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter branches…"
          aria-label="Filter branches"
        />
      </div>
      {loading ? (
        <div className="flex items-center gap-2 px-3 py-2 text-meta text-text-faint">
          <Loader2 className="size-3.5 animate-spin" aria-hidden />
          Loading branches…
        </div>
      ) : filtered.length === 0 ? (
        <p className={cn(chromeNoMatchesClassName, 'mx-2')}>No branches match.</p>
      ) : (
        filtered.map((row, idx) => (
          <ComposerPickerRow
            key={row.name}
            rowId={`branch-picker-${row.name}`}
            active={idx === focusedIdx}
            ariaLabel={row.name}
            primary={row.name}
            description={row.protected ? 'protected' : undefined}
            onMouseEnter={() => setFocusedIdx(idx)}
            onClick={() => void activate(row.name)}
          />
        ))
      )}
      {switching ? (
        <p className="px-3 py-1 font-mono text-chat-meta text-text-faint">Switching to {switching}…</p>
      ) : null}
    </ComposerPickerShell>
  );
}

interface ComposerBranchChipProps {
  workspaceId: string | null;
}

export function ComposerBranchChip({ workspaceId }: ComposerBranchChipProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const workspace = useWorkspaceStore((s) =>
    workspaceId ? s.list.find((w) => w.id === workspaceId) : undefined
  );
  const binding = workspace?.github;
  const syncMessage = useGitHubSyncStore((s) =>
    workspaceId ? s.workspaceSync[workspaceId] : undefined
  );
  const gitContext = useWorkspaceGitContext(workspaceId, Boolean(binding));
  if (!workspaceId || !binding) return null;

  const label = syncMessage
    ? syncMessage
    : formatBranchChipLabel(binding.branch, gitContext.ahead, gitContext.behind);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={cn(
          'vx-composer-branch-chip shrink-0 rounded-inner px-1.5 py-0.5 font-mono text-chat-meta text-text-faint hover:bg-chrome-hover-soft hover:text-text-secondary',
          syncMessage && 'text-text-muted'
        )}
        aria-label={
          syncMessage
            ? `Syncing branch ${binding.branch}`
            : `Branch ${binding.branch}. Click to switch.`
        }
        aria-busy={syncMessage != null}
        disabled={syncMessage != null}
        onClick={() => setOpen((o) => !o)}
      >
        {syncMessage ? (
          <Loader2 className="mr-0.5 inline size-3 animate-spin opacity-70" aria-hidden />
        ) : (
          <GitBranch className="mr-0.5 inline size-3 opacity-70" aria-hidden />
        )}
        {label}
      </button>
      <Popover open={open} onClose={() => setOpen(false)} triggerRef={triggerRef} align="start" preferSide="top">
        <BranchPickerPanel workspaceId={workspaceId} onClose={() => setOpen(false)} />
      </Popover>
    </>
  );
}
