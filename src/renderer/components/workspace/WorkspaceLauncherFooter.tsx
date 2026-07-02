/**
 * Sticky footer — branch picker, partial-clone retry, open repository.
 */

import { useRef, useState } from 'react';
import { ChevronDown, Loader2 } from 'lucide-react';
import type { GitHubBranch, GitHubRepo } from '@shared/types/github.js';
import { Button } from '../ui/Button.js';
import { Popover } from '../ui/Popover.js';
import { ShellCaption } from '../ui/ShellSection.js';
import { cn } from '../../lib/cn.js';
import { appPopoverPanelClassName } from '../ui/SurfaceShell.js';
import { SHELL_ROW_ICON_CLASS } from '../../lib/shellIcons.js';

interface WorkspaceLauncherFooterProps {
  selectedRepo: GitHubRepo;
  branches: GitHubBranch[];
  branch: string;
  onBranchChange: (name: string) => void;
  branchesLoading: boolean;
  cloneState: 'absent' | 'ready' | 'partial' | null;
  openBusy: boolean;
  repoCloneProgress: string | undefined;
  onOpen: () => void;
  onRetryClone: () => void;
  onClearSelection: () => void;
}

export function WorkspaceLauncherFooter({
  selectedRepo,
  branches,
  branch,
  onBranchChange,
  branchesLoading,
  cloneState,
  openBusy,
  repoCloneProgress,
  onOpen,
  onRetryClone,
  onClearSelection
}: WorkspaceLauncherFooterProps) {
  const branchTriggerRef = useRef<HTMLButtonElement>(null);
  const [branchMenuOpen, setBranchMenuOpen] = useState(false);

  return (
    <div className="vx-workspace-launcher-foot shrink-0 border-t border-border-subtle/30 px-2 py-2">
      {cloneState === 'partial' ? (
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2 rounded-inner border border-border-subtle/50 bg-chrome-hover-soft/40 px-2 py-1.5">
          <ShellCaption>Incomplete local clone — retry to remove and re-clone.</ShellCaption>
          <Button variant="secondary" size="sm" disabled={openBusy} onClick={onRetryClone}>
            Retry clone
          </Button>
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 flex-1 truncate font-mono text-meta text-text-muted">
          {selectedRepo.fullName}
        </span>
        <button
          type="button"
          className="vx-btn vx-btn-quiet shrink-0 px-1 text-meta text-text-faint"
          onClick={onClearSelection}
        >
          Clear
        </button>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span className="text-meta text-text-faint">Branch</span>
        {branchesLoading ? (
          <span className="text-meta text-text-faint">Loading…</span>
        ) : (
          <>
            <button
              ref={branchTriggerRef}
              type="button"
              className="vx-btn vx-btn-quiet inline-flex max-w-[12rem] items-center gap-1 truncate font-mono text-row"
              aria-haspopup="menu"
              aria-expanded={branchMenuOpen}
              aria-label="Branch"
              onClick={() => setBranchMenuOpen((v) => !v)}
            >
              <span className="truncate">{branch || selectedRepo.defaultBranch}</span>
              <ChevronDown className={cn(SHELL_ROW_ICON_CLASS, 'shrink-0')} aria-hidden />
            </button>
            <Popover
              open={branchMenuOpen}
              onClose={() => setBranchMenuOpen(false)}
              triggerRef={branchTriggerRef}
              align="start"
              offset={4}
              className={cn(appPopoverPanelClassName, 'max-h-48 min-w-[10rem] overflow-y-auto p-1')}
            >
              <div className="flex flex-col gap-0.5" role="menu">
                {branches.map((b) => (
                  <button
                    key={b.name}
                    type="button"
                    role="menuitem"
                    className={cn(
                      'vx-dropdown-item truncate font-mono',
                      b.name === branch && 'bg-dock-selection'
                    )}
                    onClick={() => {
                      onBranchChange(b.name);
                      setBranchMenuOpen(false);
                    }}
                  >
                    {b.name}
                    {b.protected ? ' (protected)' : ''}
                  </button>
                ))}
              </div>
            </Popover>
          </>
        )}
        <Button
          variant="accentFill"
          size="sm"
          className="ml-auto"
          disabled={openBusy || branchesLoading}
          onClick={onOpen}
        >
          {openBusy ? (
            <>
              <Loader2 className={cn(SHELL_ROW_ICON_CLASS, 'animate-spin')} aria-hidden />
              {repoCloneProgress ?? 'Opening…'}
            </>
          ) : (
            'Open repository'
          )}
        </Button>
      </div>
      {openBusy && repoCloneProgress ? (
        <ShellCaption className="mt-1 truncate font-mono">{repoCloneProgress}</ShellCaption>
      ) : null}
    </div>
  );
}
