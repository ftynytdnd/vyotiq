/**
 * Workspace launcher data model — local paths, GitHub auth, repos, branches.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  GitHubAccount,
  GitHubBranch,
  GitHubOrg,
  GitHubRecentRepo,
  GitHubRepo,
  GitHubRepoScope
} from '@shared/types/github.js';
import { formatGitHubIpcError } from '@shared/github/formatGitHubError.js';
import { GITHUB_NEW_TOKEN_URL } from '@shared/github/oauthConstants.js';
import { gitHubRepoSyncKey } from '@shared/github/repoSyncKey.js';
import { vyotiq } from '../../lib/ipc.js';
import { useWorkspaceStore } from '../../store/useWorkspaceStore.js';
import {
  useWorkspaceLauncherStore,
  type WorkspaceLauncherSource
} from '../../store/useWorkspaceLauncherStore.js';
import { useToastStore } from '../../store/useToastStore.js';
import { useGitHubSyncStore } from '../../store/useGitHubSyncStore.js';
import { useGitHubDeviceSignIn } from '../../hooks/useGitHubDeviceSignIn.js';
import type {
  GitHubRecentRow,
  GitHubRepoRow,
  LocalBrowseRow,
  LocalPathSubmitRow,
  LocalRecentRow,
  RepoScopeFilter,
  WorkspaceLauncherGroup,
  WorkspaceLauncherRow
} from './workspaceLauncherTypes.js';

function scopeToInput(
  filter: RepoScopeFilter
): { scope?: GitHubRepoScope; orgLogin?: string } {
  if (filter.kind === 'all') return {};
  if (filter.kind === 'user') return { scope: 'user' };
  return { scope: 'org', orgLogin: filter.login };
}

function recentToRepo(recent: GitHubRecentRepo): GitHubRepo {
  return {
    id: 0,
    fullName: `${recent.owner}/${recent.repo}`,
    owner: recent.owner,
    name: recent.repo,
    description: null,
    private: false,
    defaultBranch: recent.branch,
    updatedAt: '',
    htmlUrl: ''
  };
}

function showGitHub(source: WorkspaceLauncherSource): boolean {
  return source === 'all' || source === 'github';
}

function showLocal(source: WorkspaceLauncherSource): boolean {
  return source === 'all' || source === 'local';
}

export interface UseWorkspaceLauncherModelResult {
  query: string;
  setQuery: (q: string) => void;
  sourceFilter: WorkspaceLauncherSource;
  setSourceFilter: (f: WorkspaceLauncherSource) => void;
  close: () => void;
  groups: WorkspaceLauncherGroup[];
  flatRows: WorkspaceLauncherRow[];
  accounts: GitHubAccount[];
  accountId: string | null;
  setAccountId: (id: string) => void;
  activeAccount: GitHubAccount | null;
  orgs: GitHubOrg[];
  repoScope: RepoScopeFilter;
  setRepoScope: (scope: RepoScopeFilter) => void;
  scopePills: Array<{ key: string; label: string; filter: RepoScopeFilter }>;
  reposLoading: boolean;
  loadRepos: (refresh?: boolean) => Promise<void>;
  selectedRepo: GitHubRepo | null;
  selectRepo: (repo: GitHubRepo, branchName?: string) => void;
  clearSelection: () => void;
  branches: GitHubBranch[];
  branch: string;
  setBranch: (name: string) => void;
  branchesLoading: boolean;
  cloneState: 'absent' | 'ready' | 'partial' | null;
  openBusy: boolean;
  repoCloneProgress: string | undefined;
  onBrowseLocal: () => Promise<void>;
  onSubmitLocal: (path: string) => Promise<void>;
  onOpenGitHubRepo: (opts?: { recoverPartial?: boolean }) => Promise<void>;
  browseBusy: boolean;
  localError: string | null;
  gheHost: string;
  setGheHost: (host: string) => void;
  patToken: string;
  setPatToken: (token: string) => void;
  patBusy: boolean;
  connectWithToken: () => Promise<void>;
  openTokenPage: () => void;
  deviceBusy: boolean;
  deviceCode: string | null;
  oauthConfigured: boolean | null;
  startDeviceFlow: (host: string) => Promise<void>;
  oauthSignInDisabled: boolean;
  showConnectSection: boolean;
  connectCompact: boolean;
  connectFull: boolean;
  expandConnect: () => void;
  patFocusSignal: number;
  requestPatFocus: () => void;
}

export interface UseWorkspaceLauncherModelOptions {
  elevated?: boolean;
}

export function useWorkspaceLauncherModel(
  active: boolean,
  opts?: UseWorkspaceLauncherModelOptions
): UseWorkspaceLauncherModelResult {
  const query = useWorkspaceLauncherStore((s) => s.query);
  const setQuery = useWorkspaceLauncherStore((s) => s.setQuery);
  const sourceFilter = useWorkspaceLauncherStore((s) => s.sourceFilter);
  const setSourceFilter = useWorkspaceLauncherStore((s) => s.setSourceFilter);
  const setOpen = useWorkspaceLauncherStore((s) => s.setOpen);
  const addWorkspace = useWorkspaceStore((s) => s.add);
  const workspaceList = useWorkspaceStore((s) => s.list);

  const [localError, setLocalError] = useState<string | null>(null);
  const [browseBusy, setBrowseBusy] = useState(false);

  const [accounts, setAccounts] = useState<GitHubAccount[]>([]);
  const [accountId, setAccountIdState] = useState<string | null>(null);
  const [repos, setRepos] = useState<GitHubRepo[]>([]);
  const [reposLoading, setReposLoading] = useState(false);
  const [selectedRepo, setSelectedRepo] = useState<GitHubRepo | null>(null);
  const [branches, setBranches] = useState<GitHubBranch[]>([]);
  const [branch, setBranch] = useState('');
  const [branchesLoading, setBranchesLoading] = useState(false);
  const [openBusy, setOpenBusy] = useState(false);
  const [gheHost, setGheHost] = useState('github.com');
  const [orgs, setOrgs] = useState<GitHubOrg[]>([]);
  const [repoScope, setRepoScope] = useState<RepoScopeFilter>({ kind: 'all' });
  const [recentRepos, setRecentRepos] = useState<GitHubRecentRepo[]>([]);
  const [cloneState, setCloneState] = useState<'absent' | 'ready' | 'partial' | null>(null);
  const [patToken, setPatToken] = useState('');
  const [patBusy, setPatBusy] = useState(false);
  const [connectExpanded, setConnectExpanded] = useState(false);
  const [patFocusSignal, setPatFocusSignal] = useState(0);

  const refreshAccounts = useCallback(async () => {
    try {
      const rows = await vyotiq.github.listAccounts();
      setAccounts(rows);
      setAccountIdState((current) => {
        if (rows.length === 0) return null;
        if (current && rows.some((a) => a.id === current)) return current;
        return rows[0]!.id;
      });
    } catch {
      setAccounts([]);
      setAccountIdState(null);
    }
  }, []);

  const {
    deviceBusy,
    deviceCode,
    oauthConfigured,
    refreshOAuthStatus,
    startDeviceFlow
  } = useGitHubDeviceSignIn((connectedId) => {
    void refreshAccounts().then(() => setAccountIdState(connectedId));
  });

  const recentPaths = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const ws of workspaceList) {
      const p = ws.path?.trim();
      if (!p || seen.has(p)) continue;
      seen.add(p);
      out.push(p);
    }
    return out;
  }, [workspaceList]);

  const activeAccount = useMemo(
    () => accounts.find((a) => a.id === accountId) ?? null,
    [accounts, accountId]
  );

  const selectedRepoKey = selectedRepo
    ? gitHubRepoSyncKey(selectedRepo.owner, selectedRepo.name)
    : null;
  const repoCloneProgress = useGitHubSyncStore((s) =>
    selectedRepoKey ? s.repoSync[selectedRepoKey] : undefined
  );

  const close = useCallback(() => {
    setOpen(false);
    setSelectedRepo(null);
    setLocalError(null);
  }, [setOpen]);

  const setAccountId = useCallback((id: string) => {
    setAccountIdState(id);
    setSelectedRepo(null);
    setRepoScope({ kind: 'all' });
  }, []);

  useEffect(() => {
    if (!active) {
      setConnectExpanded(false);
      return;
    }
    if (sourceFilter === 'github' || opts?.elevated) {
      setConnectExpanded(true);
    }
    if (sourceFilter === 'all' && !opts?.elevated) {
      setConnectExpanded(false);
    }
  }, [active, sourceFilter, opts?.elevated]);

  const expandConnect = useCallback(() => {
    setConnectExpanded(true);
  }, []);

  const requestPatFocus = useCallback(() => {
    setPatFocusSignal((n) => n + 1);
  }, []);

  useEffect(() => {
    if (!active) return;
    setLocalError(null);
    setSelectedRepo(null);
    void refreshAccounts();
  }, [active, refreshAccounts]);

  useEffect(() => {
    if (!active || !showGitHub(sourceFilter)) return;
    void refreshOAuthStatus();
  }, [active, sourceFilter, refreshOAuthStatus]);

  const loadRepos = useCallback(
    async (refresh = false) => {
      if (!accountId) return;
      setReposLoading(true);
      try {
        const scopeInput = scopeToInput(repoScope);
        const rows = await vyotiq.github.listRepos({
          accountId,
          refresh,
          query: query.trim() || undefined,
          ...scopeInput
        });
        setRepos(rows);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        useToastStore.getState().show(msg, 'danger');
        setRepos([]);
      } finally {
        setReposLoading(false);
      }
    },
    [accountId, query, repoScope]
  );

  useEffect(() => {
    if (!active || !showGitHub(sourceFilter) || !accountId) return;
    const timer = window.setTimeout(() => void loadRepos(false), 200);
    return () => window.clearTimeout(timer);
  }, [active, sourceFilter, accountId, query, repoScope, loadRepos]);

  const loadOrgsAndRecent = useCallback(async () => {
    if (!accountId) {
      setOrgs([]);
      setRecentRepos([]);
      return;
    }
    try {
      const [orgRows, recentRows] = await Promise.all([
        vyotiq.github.listOrgs(accountId),
        vyotiq.github.listRecentRepos(accountId)
      ]);
      setOrgs(orgRows);
      setRecentRepos(recentRows);
    } catch {
      setOrgs([]);
      setRecentRepos([]);
    }
  }, [accountId]);

  useEffect(() => {
    if (!active || !showGitHub(sourceFilter) || !accountId) return;
    void loadOrgsAndRecent();
  }, [active, sourceFilter, accountId, loadOrgsAndRecent]);

  useEffect(() => {
    if (!accountId || !selectedRepo) {
      setCloneState(null);
      return;
    }
    let cancelled = false;
    void vyotiq.github
      .getCloneState(accountId, selectedRepo.owner, selectedRepo.name)
      .then((result) => {
        if (!cancelled) setCloneState(result.state);
      })
      .catch(() => {
        if (!cancelled) setCloneState(null);
      });
    return () => {
      cancelled = true;
    };
  }, [accountId, selectedRepo]);

  const loadBranches = useCallback(
    async (repo: GitHubRepo, preferredBranch?: string) => {
      if (!accountId) return;
      setBranchesLoading(true);
      try {
        const rows = await vyotiq.github.listBranches(accountId, repo.owner, repo.name);
        setBranches(rows);
        const defaultBranch =
          preferredBranch ??
          rows.find((b) => b.name === repo.defaultBranch)?.name ??
          rows[0]?.name ??
          '';
        setBranch(defaultBranch);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        useToastStore.getState().show(msg, 'danger');
        setBranches([]);
        setBranch(preferredBranch ?? repo.defaultBranch);
      } finally {
        setBranchesLoading(false);
      }
    },
    [accountId]
  );

  const selectRepo = useCallback(
    (repo: GitHubRepo, branchName?: string) => {
      setSelectedRepo(repo);
      void loadBranches(repo, branchName);
    },
    [loadBranches]
  );

  const clearSelection = useCallback(() => {
    setSelectedRepo(null);
    setBranch('');
    setBranches([]);
  }, []);

  const onBrowseLocal = useCallback(async () => {
    setBrowseBusy(true);
    try {
      const picked = await vyotiq.workspace.pickDirectory();
      if (picked) {
        setLocalError(null);
        try {
          await addWorkspace(picked);
          close();
        } catch (err) {
          setLocalError(err instanceof Error ? err.message : String(err));
        }
      }
    } finally {
      setBrowseBusy(false);
    }
  }, [addWorkspace, close]);

  const onSubmitLocal = useCallback(
    async (path: string) => {
      const trimmed = path.trim();
      if (!trimmed) return;
      setLocalError(null);
      try {
        await addWorkspace(trimmed);
        close();
      } catch (err) {
        setLocalError(err instanceof Error ? err.message : String(err));
      }
    },
    [addWorkspace, close]
  );

  const onOpenGitHubRepo = useCallback(
    async (opts?: { recoverPartial?: boolean }) => {
      if (!accountId || !selectedRepo) return;
      const branchName = branch.trim() || undefined;
      setOpenBusy(true);
      try {
        await vyotiq.github.openRepo({
          accountId,
          owner: selectedRepo.owner,
          repo: selectedRepo.name,
          branch: branchName,
          recoverPartial: opts?.recoverPartial
        });
        await useWorkspaceStore.getState().refresh();
        await loadOrgsAndRecent();
        close();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        useToastStore.getState().show(msg, 'danger');
      } finally {
        setOpenBusy(false);
      }
    },
    [accountId, selectedRepo, branch, loadOrgsAndRecent, close]
  );

  const openTokenPage = useCallback(() => {
    void vyotiq.browser.openExternal({ url: GITHUB_NEW_TOKEN_URL });
  }, []);

  const connectWithToken = useCallback(async () => {
    setPatBusy(true);
    try {
      const account = await vyotiq.github.addPat({
        host: gheHost.trim() || 'github.com',
        token: patToken
      });
      setPatToken('');
      await refreshAccounts();
      setAccountIdState(account.id);
      useToastStore.getState().show(`Connected as ${account.login}`, 'success');
    } catch (err) {
      useToastStore.getState().show(formatGitHubIpcError(err), 'danger');
    } finally {
      setPatBusy(false);
    }
  }, [gheHost, patToken, refreshAccounts]);

  const oauthSignInDisabled = deviceBusy || oauthConfigured === false;
  const showConnectSection = showGitHub(sourceFilter) && accounts.length === 0;
  const connectCompact = showConnectSection && sourceFilter === 'all' && !connectExpanded;
  const connectFull = showConnectSection && !connectCompact;

  const scopePills = useMemo(() => {
    if (!activeAccount) return [];
    return [
      { key: 'all', label: 'All', filter: { kind: 'all' as const } },
      { key: 'user', label: `@${activeAccount.login}`, filter: { kind: 'user' as const } },
      ...orgs.map((org) => ({
        key: org.login,
        label: org.login,
        filter: { kind: 'org' as const, login: org.login }
      }))
    ];
  }, [activeAccount, orgs]);

  const { groups, flatRows } = useMemo(() => {
    const groupsOut: WorkspaceLauncherGroup[] = [];
    const flat: WorkspaceLauncherRow[] = [];
    const q = query.trim().toLowerCase();

    const pushGroup = (id: string, label: string, rows: WorkspaceLauncherRow[]) => {
      if (rows.length === 0) return;
      groupsOut.push({ id, label, rows });
      flat.push(...rows);
    };

    if (showLocal(sourceFilter)) {
      const recentLocal: LocalRecentRow[] = recentPaths
        .filter((p) => !q || p.toLowerCase().includes(q))
        .map((path) => ({
          id: `local:${path}`,
          kind: 'local-recent',
          path,
          ariaLabel: path
        }));
      pushGroup('recent-local', 'Recent', recentLocal);

      const localRows: WorkspaceLauncherRow[] = [
        {
          id: 'local:browse',
          kind: 'local-browse',
          ariaLabel: 'Browse folder'
        } satisfies LocalBrowseRow
      ];

      if (q && !recentLocal.some((r) => r.path.toLowerCase() === q)) {
        localRows.push({
          id: `local:submit:${query.trim()}`,
          kind: 'local-path-submit',
          path: query.trim(),
          ariaLabel: `Open folder ${query.trim()}`
        } satisfies LocalPathSubmitRow);
      }

      pushGroup('local', 'Local', localRows);
    }

    if (showGitHub(sourceFilter) && accounts.length > 0) {
      const recentGh: GitHubRecentRow[] = recentRepos
        .filter((recent) => {
          const label = `${recent.owner}/${recent.repo}`;
          return !q || label.toLowerCase().includes(q);
        })
        .map((recent) => {
          const repo = recentToRepo(recent);
          return {
            id: `gh-recent:${recent.owner}/${recent.repo}`,
            kind: 'github-recent',
            recent,
            repo,
            ariaLabel: `${recent.owner}/${recent.repo} @ ${recent.branch}`
          };
        });
      pushGroup('recent-github', 'Recent', recentGh);

      const repoRows: GitHubRepoRow[] = repos.slice(0, 80).map((repo) => ({
        id: `gh-repo:${repo.fullName}`,
        kind: 'github-repo',
        repo,
        description: repo.description,
        ariaLabel: repo.description
          ? `${repo.fullName} ${repo.description}`
          : repo.fullName
      }));
      pushGroup('github', 'GitHub', repoRows);
    }

    if (connectCompact) {
      pushGroup('connect', 'Connect', [
        {
          id: 'connect:expand',
          kind: 'github-connect',
          ariaLabel: 'Connect GitHub account'
        }
      ]);
    }

    if (connectFull) {
      if (oauthConfigured !== false) {
        flat.push({
          id: 'connect:sign-in',
          kind: 'github-connect-sign-in',
          ariaLabel: 'Sign in with GitHub'
        });
      }
      flat.push({
        id: 'connect:token',
        kind: 'github-connect-token',
        ariaLabel: 'Connect with token'
      });
    }

    return { groups: groupsOut, flatRows: flat };
  }, [
    sourceFilter,
    recentPaths,
    query,
    accounts.length,
    recentRepos,
    repos,
    connectCompact,
    connectFull,
    oauthConfigured
  ]);

  return {
    query,
    setQuery,
    sourceFilter,
    setSourceFilter,
    close,
    groups,
    flatRows,
    accounts,
    accountId,
    setAccountId,
    activeAccount,
    orgs,
    repoScope,
    setRepoScope,
    scopePills,
    reposLoading,
    loadRepos,
    selectedRepo,
    selectRepo,
    clearSelection,
    branches,
    branch,
    setBranch,
    branchesLoading,
    cloneState,
    openBusy,
    repoCloneProgress,
    onBrowseLocal,
    onSubmitLocal,
    onOpenGitHubRepo,
    browseBusy,
    localError,
    gheHost,
    setGheHost,
    patToken,
    setPatToken,
    patBusy,
    connectWithToken,
    openTokenPage,
    deviceBusy,
    deviceCode,
    oauthConfigured,
    startDeviceFlow,
    oauthSignInDisabled,
    showConnectSection,
    connectCompact,
    connectFull,
    expandConnect,
    patFocusSignal,
    requestPatFocus
  };
}
