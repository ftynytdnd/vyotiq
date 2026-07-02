/**
 * Source pills, GitHub account menu, refresh, and add-account controls.
 */

import { useRef, useState } from 'react';
import { ChevronDown, FolderGit2, FolderOpen, RefreshCw } from 'lucide-react';
import type { GitHubAccount } from '@shared/types/github.js';
import { Popover } from '../ui/Popover.js';
import { Button } from '../ui/Button.js';
import { cn } from '../../lib/cn.js';
import {
  appPopoverPanelClassName,
  chromePillClassName,
  chromeToolbarButtonClassName
} from '../ui/SurfaceShell.js';
import { SHELL_ROW_ICON_CLASS, SHELL_ROW_ICON_STROKE } from '../../lib/shellIcons.js';
import type { WorkspaceLauncherSource } from '../../store/useWorkspaceLauncherStore.js';
import type { RepoScopeFilter } from './workspaceLauncherTypes.js';

const SOURCE_PILLS: Array<{ id: WorkspaceLauncherSource; label: string; icon: typeof FolderOpen }> = [
  { id: 'all', label: 'All', icon: FolderOpen },
  { id: 'local', label: 'Local', icon: FolderOpen },
  { id: 'github', label: 'GitHub', icon: FolderGit2 }
];

interface WorkspaceLauncherToolbarProps {
  sourceFilter: WorkspaceLauncherSource;
  onSourceFilter: (source: WorkspaceLauncherSource) => void;
  accounts: GitHubAccount[];
  accountId: string | null;
  onAccountChange: (id: string) => void;
  onRefreshRepos: () => void;
  onAddAccount: () => void;
  oauthSignInDisabled: boolean;
  oauthConfigured: boolean | null;
  scopePills: Array<{ key: string; label: string; filter: RepoScopeFilter }>;
  repoScope: RepoScopeFilter;
  onRepoScope: (filter: RepoScopeFilter) => void;
  showGitHubControls: boolean;
}

export function WorkspaceLauncherToolbar({
  sourceFilter,
  onSourceFilter,
  accounts,
  accountId,
  onAccountChange,
  onRefreshRepos,
  onAddAccount,
  oauthSignInDisabled,
  oauthConfigured,
  scopePills,
  repoScope,
  onRepoScope,
  showGitHubControls
}: WorkspaceLauncherToolbarProps) {
  const accountTriggerRef = useRef<HTMLButtonElement>(null);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const activeAccount = accounts.find((a) => a.id === accountId) ?? null;

  return (
    <div className="flex flex-col gap-1.5 px-0.5 pb-1">
      <div className="flex flex-wrap items-center gap-1">
        {SOURCE_PILLS.map((pill) => {
          const Icon = pill.icon;
          const active = sourceFilter === pill.id;
          return (
            <button
              key={pill.id}
              type="button"
              className={cn(chromePillClassName(active), 'gap-1')}
              aria-pressed={active}
              onClick={() => onSourceFilter(pill.id)}
            >
              {pill.id !== 'all' ? (
                <Icon className={SHELL_ROW_ICON_CLASS} strokeWidth={SHELL_ROW_ICON_STROKE} aria-hidden />
              ) : null}
              {pill.label}
            </button>
          );
        })}
        {showGitHubControls && accounts.length > 0 ? (
          <>
            <button
              ref={accountTriggerRef}
              type="button"
              className={cn(chromePillClassName(accountMenuOpen), 'ml-auto max-w-[9rem] gap-0.5 truncate')}
              aria-label="GitHub account"
              aria-haspopup="menu"
              aria-expanded={accountMenuOpen}
              onClick={() => setAccountMenuOpen((v) => !v)}
            >
              <span className="truncate font-mono">
                {activeAccount ? `@${activeAccount.login}` : 'Account'}
              </span>
              <ChevronDown className={cn(SHELL_ROW_ICON_CLASS, 'shrink-0')} strokeWidth={SHELL_ROW_ICON_STROKE} />
            </button>
            <Popover
              open={accountMenuOpen}
              onClose={() => setAccountMenuOpen(false)}
              triggerRef={accountTriggerRef}
              align="start"
              offset={4}
              className={cn(appPopoverPanelClassName, 'min-w-[12rem] p-1')}
            >
              <div className="flex flex-col gap-0.5" role="menu">
                {accounts.map((account) => (
                  <button
                    key={account.id}
                    type="button"
                    role="menuitem"
                    className={cn(
                      'vx-dropdown-item truncate font-mono',
                      account.id === accountId && 'bg-dock-selection'
                    )}
                    onClick={() => {
                      onAccountChange(account.id);
                      setAccountMenuOpen(false);
                    }}
                  >
                    {account.login} @{account.host}
                  </button>
                ))}
              </div>
            </Popover>
            <button
              type="button"
              className={cn(chromeToolbarButtonClassName(), 'h-6 w-6 shrink-0 px-0')}
              title="Refresh repositories"
              aria-label="Refresh repositories"
              onClick={() => onRefreshRepos()}
            >
              <RefreshCw className={SHELL_ROW_ICON_CLASS} strokeWidth={SHELL_ROW_ICON_STROKE} />
            </button>
            <Button
              variant="secondary"
              size="sm"
              disabled={oauthSignInDisabled}
              title={
                oauthConfigured === false
                  ? 'Configure an OAuth App client ID in Settings first'
                  : undefined
              }
              onClick={onAddAccount}
            >
              Add account
            </Button>
          </>
        ) : null}
      </div>
      {showGitHubControls && scopePills.length > 0 ? (
        <div className="flex gap-1 overflow-x-auto pb-0.5" role="group" aria-label="Repository scope">
          {scopePills.map((pill) => {
            const active =
              pill.filter.kind === repoScope.kind &&
              (pill.filter.kind !== 'org' ||
                (repoScope.kind === 'org' && repoScope.login === pill.filter.login));
            return (
              <button
                key={pill.key}
                type="button"
                className={cn(chromePillClassName(active), 'shrink-0')}
                onClick={() => onRepoScope(pill.filter)}
              >
                {pill.label}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
