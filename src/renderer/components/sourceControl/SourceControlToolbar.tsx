/**
 * Source control toolbar — branch chip and compact sync actions.
 */

import {
  ArrowDown,
  ArrowUp,
  Download,
  GitBranch,
  RefreshCw
} from 'lucide-react';
import { cn } from '../../lib/cn.js';
import {
  WORKBENCH_ACTION_GROUP_CLASS,
  WORKBENCH_ACTIONS_TRAY_CLASS,
  WORKBENCH_ICON_BTN_CLASS,
  WORKBENCH_TOOLBAR_CLASS
} from '../workbench/workbenchChrome.js';
import { SHELL_ROW_ICON_CLASS, SHELL_ROW_ICON_STROKE } from '../../lib/shellIcons.js';
import type { WorkspaceGitContext } from '@shared/types/ipc.js';

interface SourceControlToolbarProps {
  branchLabel: string;
  syncSuffix: string;
  context: WorkspaceGitContext;
  totalChanges: number;
  busy: boolean;
  branchOpen: boolean;
  onBranchToggle: () => void;
  onRefresh: () => void;
  onFetch: () => void;
  onPull: () => void;
  onPush: () => void;
  syncDisabledTitle?: string;
}

export function SourceControlToolbar({
  branchLabel,
  syncSuffix,
  context,
  totalChanges,
  busy,
  branchOpen,
  onBranchToggle,
  onRefresh,
  onFetch,
  onPull,
  onPush,
  syncDisabledTitle
}: SourceControlToolbarProps) {
  const canSync = context.isRepo && Boolean(context.remote);
  const syncDisabled = busy || !canSync;

  return (
    <header className={cn(WORKBENCH_TOOLBAR_CLASS, 'vx-sc-toolbar')}>
      <button
        type="button"
        className={cn('vx-sc-branch-chip app-no-drag', branchOpen && 'vx-sc-branch-chip--open')}
        onClick={onBranchToggle}
        title="Switch branch"
        aria-label={`Branch ${branchLabel}${syncSuffix}`}
        aria-expanded={branchOpen}
        aria-haspopup="listbox"
      >
        <GitBranch className={SHELL_ROW_ICON_CLASS} strokeWidth={SHELL_ROW_ICON_STROKE} aria-hidden />
        <span className="truncate">{branchLabel}</span>
        {totalChanges > 0 ? (
          <span className="vx-sc-change-badge" aria-label={`${totalChanges} changed files`}>
            {totalChanges}
          </span>
        ) : null}
      </button>

      {context.ahead || context.behind ? (
        <div className="vx-sc-sync-status" aria-label={`Sync status${syncSuffix}`}>
          {context.ahead ? (
            <span className="vx-sc-sync-pill vx-sc-sync-pill--ahead">↑{context.ahead}</span>
          ) : null}
          {context.behind ? (
            <span className="vx-sc-sync-pill vx-sc-sync-pill--behind">↓{context.behind}</span>
          ) : null}
        </div>
      ) : canSync ? (
        <span className="vx-sc-sync-ok">synced</span>
      ) : null}

      <div className="min-w-0 flex-1" />

      <div className={WORKBENCH_ACTIONS_TRAY_CLASS}>
        <div className={WORKBENCH_ACTION_GROUP_CLASS} role="group" aria-label="Remote sync">
          <button
            type="button"
            className={cn(WORKBENCH_ICON_BTN_CLASS, 'vx-sc-toolbar-btn')}
            disabled={busy}
            title="Refresh git status"
            aria-label="Refresh"
            onClick={onRefresh}
          >
            <RefreshCw className={SHELL_ROW_ICON_CLASS} strokeWidth={SHELL_ROW_ICON_STROKE} />
          </button>
          <button
            type="button"
            className={cn(WORKBENCH_ICON_BTN_CLASS, 'vx-sc-toolbar-btn')}
            disabled={syncDisabled}
            title={syncDisabledTitle ?? 'Fetch from remote'}
            aria-label="Fetch"
            onClick={onFetch}
          >
            <Download className={SHELL_ROW_ICON_CLASS} strokeWidth={SHELL_ROW_ICON_STROKE} />
          </button>
          <button
            type="button"
            className={cn(
              WORKBENCH_ICON_BTN_CLASS,
              'vx-sc-toolbar-btn',
              context.behind && !syncDisabled && 'vx-sc-toolbar-btn--highlight'
            )}
            disabled={syncDisabled || !context.behind}
            title={syncDisabledTitle ?? 'Pull from remote'}
            aria-label="Pull"
            onClick={onPull}
          >
            <ArrowDown className={SHELL_ROW_ICON_CLASS} strokeWidth={SHELL_ROW_ICON_STROKE} />
          </button>
          <button
            type="button"
            className={cn(
              WORKBENCH_ICON_BTN_CLASS,
              'vx-sc-toolbar-btn',
              context.ahead && !syncDisabled && 'vx-sc-toolbar-btn--highlight'
            )}
            disabled={syncDisabled}
            title={syncDisabledTitle ?? 'Push to remote'}
            aria-label="Push"
            onClick={onPush}
          >
            <ArrowUp className={SHELL_ROW_ICON_CLASS} strokeWidth={SHELL_ROW_ICON_STROKE} />
          </button>
        </div>
      </div>
    </header>
  );
}
