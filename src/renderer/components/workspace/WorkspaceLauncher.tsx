/**
 * Workspace launcher — search-first palette for local folders and GitHub repos.
 */

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import { cn } from '../../lib/cn.js';
import {
  SHELL_CHROME_ICON_CLASS,
  SHELL_CHROME_ICON_STROKE,
  SHELL_ROW_ICON_CLASS,
  SHELL_ROW_ICON_STROKE
} from '../../lib/shellIcons.js';
import { ComposerPickerHints } from '../composer/picker/ComposerPickerHints.js';
import { PanelHeader } from '../ui/PanelHeader.js';
import { ShellCaption } from '../ui/ShellSection.js';
import { WorkspaceLauncherConnect } from './WorkspaceLauncherConnect.js';
import { WorkspaceLauncherFooter } from './WorkspaceLauncherFooter.js';
import { WorkspaceLauncherResults } from './WorkspaceLauncherResults.js';
import { WorkspaceLauncherToolbar } from './WorkspaceLauncherToolbar.js';
import { useWorkspaceLauncherModel } from './useWorkspaceLauncherModel.js';
import type { WorkspaceLauncherRow } from './workspaceLauncherTypes.js';

export interface WorkspaceLauncherProps {
  active: boolean;
  /** Elevated portal shows a titled header; inline dock flyout is search-only chrome. */
  elevated?: boolean;
  onClose: () => void;
}

export function WorkspaceLauncher({ active, elevated = false, onClose }: WorkspaceLauncherProps) {
  const titleId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [activeIndex, setActiveIndex] = useState(-1);
  const model = useWorkspaceLauncherModel(active, { elevated });

  const activeRow = activeIndex >= 0 ? model.flatRows[activeIndex] : null;
  const activeConnectAction =
    activeRow?.kind === 'github-connect-sign-in'
      ? 'sign-in'
      : activeRow?.kind === 'github-connect-token'
        ? 'token'
        : null;

  useEffect(() => {
    if (!active) return;
    setActiveIndex(-1);
    const raf = requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
    return () => cancelAnimationFrame(raf);
  }, [active, model.sourceFilter]);

  useEffect(() => {
    setActiveIndex(-1);
  }, [model.query, model.flatRows.length, model.sourceFilter]);

  const activateRow = useCallback(
    (row: WorkspaceLauncherRow) => {
      switch (row.kind) {
        case 'local-recent':
        case 'local-path-submit':
          void model.onSubmitLocal(row.path);
          break;
        case 'local-browse':
          void model.onBrowseLocal();
          break;
        case 'github-recent':
          model.selectRepo(row.repo, row.recent.branch);
          break;
        case 'github-repo':
          model.selectRepo(row.repo);
          break;
        case 'github-connect':
          model.expandConnect();
          break;
        case 'github-connect-sign-in':
          void model.startDeviceFlow(model.gheHost);
          break;
        case 'github-connect-token':
          if (model.patToken.trim()) {
            void model.connectWithToken();
          } else {
            model.requestPatFocus();
          }
          break;
        default: {
          const _exhaustive: never = row;
          return _exhaustive;
        }
      }
    },
    [model]
  );

  const onEnter = useCallback(() => {
    if (model.selectedRepo) {
      void model.onOpenGitHubRepo();
      return;
    }
    const row =
      activeIndex >= 0
        ? model.flatRows[activeIndex]
        : model.query.trim().length > 0
          ? model.flatRows[0]
          : null;
    if (row) activateRow(row);
  }, [activeIndex, activateRow, model]);

  const showGitHubControls =
    (model.sourceFilter === 'all' || model.sourceFilter === 'github') && model.accounts.length > 0;

  const body = (
    <div className="vx-workspace-launcher flex min-h-0 flex-col gap-1">
      <div className="flex items-center gap-1.5 px-0.5">
        <Search
          className={cn(SHELL_ROW_ICON_CLASS, 'text-text-faint')}
          strokeWidth={SHELL_ROW_ICON_STROKE}
          aria-hidden
        />
        <input
          ref={inputRef}
          type="search"
          role="searchbox"
          value={model.query}
          aria-label="Open workspace"
          aria-labelledby={elevated ? titleId : undefined}
          aria-controls="workspace-launcher-results"
          aria-expanded={model.flatRows.length > 0 || model.connectFull}
          onChange={(e) => model.setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation();
              if (model.selectedRepo) {
                model.clearSelection();
                return;
              }
              onClose();
              return;
            }
            if (e.key === 'ArrowDown') {
              if (model.flatRows.length === 0) return;
              e.preventDefault();
              setActiveIndex((i) => (i + 1) % model.flatRows.length);
              return;
            }
            if (e.key === 'ArrowUp') {
              if (model.flatRows.length === 0) return;
              e.preventDefault();
              setActiveIndex((i) => (i <= 0 ? model.flatRows.length - 1 : i - 1));
              return;
            }
            if (e.key === 'Enter') {
              e.preventDefault();
              onEnter();
            }
          }}
          placeholder="Search folders and repositories…"
          className="vx-input min-w-0 flex-1 py-0.5 text-row"
        />
        {!elevated ? (
          <button
            type="button"
            aria-label="Close workspace launcher"
            onClick={onClose}
            className="vx-btn vx-btn-quiet h-6 w-6 shrink-0 px-0"
          >
            <X className={SHELL_CHROME_ICON_CLASS} strokeWidth={SHELL_CHROME_ICON_STROKE} />
          </button>
        ) : null}
      </div>

      <WorkspaceLauncherToolbar
        sourceFilter={model.sourceFilter}
        onSourceFilter={model.setSourceFilter}
        accounts={model.accounts}
        accountId={model.accountId}
        onAccountChange={model.setAccountId}
        onRefreshRepos={() => void model.loadRepos(true)}
        onAddAccount={() => void model.startDeviceFlow(model.gheHost)}
        oauthSignInDisabled={model.oauthSignInDisabled}
        oauthConfigured={model.oauthConfigured}
        scopePills={model.scopePills}
        repoScope={model.repoScope}
        onRepoScope={model.setRepoScope}
        showGitHubControls={showGitHubControls}
      />

      {model.localError ? (
        <ShellCaption className="px-2 text-danger">{model.localError}</ShellCaption>
      ) : null}

      <WorkspaceLauncherResults
        groups={model.groups}
        flatRows={model.flatRows}
        activeIndex={activeIndex}
        selectedRepoFullName={model.selectedRepo?.fullName ?? null}
        reposLoading={model.reposLoading}
        onActiveIndexChange={setActiveIndex}
        onActivateRow={activateRow}
        showConnectSection={model.connectFull}
        connectSection={
          <WorkspaceLauncherConnect
            gheHost={model.gheHost}
            setGheHost={model.setGheHost}
            patToken={model.patToken}
            setPatToken={model.setPatToken}
            patBusy={model.patBusy}
            connectWithToken={model.connectWithToken}
            openTokenPage={model.openTokenPage}
            deviceBusy={model.deviceBusy}
            deviceCode={model.deviceCode}
            oauthConfigured={model.oauthConfigured}
            startDeviceFlow={model.startDeviceFlow}
            oauthSignInDisabled={model.oauthSignInDisabled}
            patFocusSignal={model.patFocusSignal}
            activeAction={activeConnectAction}
          />
        }
      />

      {model.selectedRepo ? (
        <WorkspaceLauncherFooter
          selectedRepo={model.selectedRepo}
          branches={model.branches}
          branch={model.branch}
          onBranchChange={model.setBranch}
          branchesLoading={model.branchesLoading}
          cloneState={model.cloneState}
          openBusy={model.openBusy}
          repoCloneProgress={model.repoCloneProgress}
          onOpen={() => void model.onOpenGitHubRepo()}
          onRetryClone={() => void model.onOpenGitHubRepo({ recoverPartial: true })}
          onClearSelection={model.clearSelection}
        />
      ) : null}

      {model.flatRows.length > 0 ? (
        <ComposerPickerHints selectLabel={model.selectedRepo ? 'open repository' : 'select'} />
      ) : null}
    </div>
  );

  if (elevated) {
    return (
      <div
        role="search"
        aria-label="Open workspace"
        className="vx-composer-dialog vyotiq-composer-dialog-enter flex w-full flex-col"
      >
        <PanelHeader title="Open workspace" titleId={titleId} onClose={onClose} />
        <div className="vx-composer-dialog-body p-3">{body}</div>
      </div>
    );
  }

  return body;
}
