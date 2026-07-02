/**
 * GitHub accounts management in Settings → Workspace data.
 */

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, FolderGit2, Loader2, RefreshCw, Trash2 } from 'lucide-react';
import type { GitHubAccount } from '@shared/types/github.js';
import {
  formatGitHubVerifiedAt,
  isGitHubAccountStale
} from '@shared/github/accountHealth.js';
import {
  formatGitHubIpcError
} from '@shared/github/formatGitHubError.js';
import { GITHUB_NEW_TOKEN_URL } from '@shared/github/oauthConstants.js';
import { vyotiq } from '../../lib/ipc.js';
import { useSettingsStore } from '../../store/useSettingsStore.js';
import { persistSettingsPatch } from '../../lib/persistSettingsPatch.js';
import { useGitHubDeviceSignIn } from '../../hooks/useGitHubDeviceSignIn.js';
import { Button } from '../ui/Button.js';
import { TextField } from '../ui/TextField.js';
import { ShellCaption, ShellFieldLabel, ShellRow, ShellSection } from '../ui/ShellSection.js';
import { SHELL_ROW_ICON_CLASS, SHELL_ROW_ICON_STROKE } from '../../lib/shellIcons.js';
import { useToastStore } from '../../store/useToastStore.js';
import { openWorkspaceLauncher } from '../../store/useWorkspaceLauncherStore.js';
import { GitHubOAuthAdvancedPanel } from './GitHubOAuthAdvancedPanel.js';
import { cn } from '../../lib/cn.js';

export function GitHubAccountsPanel() {
  const settings = useSettingsStore((s) => s.settings);
  const [accounts, setAccounts] = useState<GitHubAccount[]>([]);
  const [patHost, setPatHost] = useState('github.com');
  const [patToken, setPatToken] = useState('');
  const [patBusy, setPatBusy] = useState(false);
  const [verifyBusyId, setVerifyBusyId] = useState<string | null>(null);
  const [oauthClientId, setOauthClientId] = useState(settings.ui?.githubOAuthClientId ?? '');
  const [signInHost, setSignInHost] = useState('github.com');

  const refresh = useCallback(async () => {
    try {
      setAccounts(await vyotiq.github.listAccounts());
    } catch {
      setAccounts([]);
    }
  }, []);

  const {
    deviceBusy,
    deviceCode,
    oauthConfigured,
    refreshOAuthStatus,
    startDeviceFlow
  } = useGitHubDeviceSignIn(() => {
    void refresh();
  });

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    setOauthClientId(settings.ui?.githubOAuthClientId ?? '');
  }, [settings.ui?.githubOAuthClientId]);

  const saveOAuthClientId = async () => {
    const next = oauthClientId.trim();
    await persistSettingsPatch({
      ui: { ...settings.ui, githubOAuthClientId: next || undefined }
    });
    await refreshOAuthStatus();
    useToastStore.getState().show(
      next ? 'GitHub OAuth client ID override saved.' : 'OAuth client ID override cleared.',
      'success'
    );
  };

  const openTokenPage = () => {
    void vyotiq.browser.openExternal({ url: GITHUB_NEW_TOKEN_URL });
  };

  const addPat = async () => {
    setPatBusy(true);
    try {
      await vyotiq.github.addPat({ host: patHost.trim() || 'github.com', token: patToken });
      setPatToken('');
      await refresh();
      useToastStore.getState().show('GitHub account connected.', 'success');
    } catch (err) {
      useToastStore.getState().show(formatGitHubIpcError(err), 'danger');
    } finally {
      setPatBusy(false);
    }
  };

  const verifyAccount = async (id: string) => {
    setVerifyBusyId(id);
    try {
      await vyotiq.github.verifyAccount(id);
      await refresh();
      useToastStore.getState().show('GitHub account verified.', 'success');
    } catch (err) {
      await refresh();
      useToastStore.getState().show(formatGitHubIpcError(err), 'danger');
    } finally {
      setVerifyBusyId(null);
    }
  };

  const removeAccount = async (id: string) => {
    await vyotiq.github.removeAccount(id);
    await refresh();
  };

  const oauthSignInDisabled = deviceBusy || oauthConfigured === false;

  return (
    <ShellSection>
      <ShellRow className="pt-0">
        <ShellCaption>
          Connect one or more GitHub accounts to clone repositories into{' '}
          <span className="font-mono">%APPDATA%/vyotiq/vyotiq/repos/</span>. Tokens stay encrypted in
          the main process — the renderer never sees them.
        </ShellCaption>
      </ShellRow>

      <ShellRow className="flex flex-wrap gap-2 py-0">
        <Button variant="accentFill" size="sm" onClick={() => openWorkspaceLauncher('github', 'elevated')}>
          <FolderGit2 className={SHELL_ROW_ICON_CLASS} strokeWidth={SHELL_ROW_ICON_STROKE} aria-hidden />
          Open from GitHub…
        </Button>
      </ShellRow>

      <ShellRow className="flex flex-col gap-2 border-t border-border-subtle/30 pt-3">
        <ShellFieldLabel>Sign in with GitHub</ShellFieldLabel>
        <ShellCaption>
          Opens your browser to authorize Vyotiq. Works on github.com when this build includes the
          Vyotiq OAuth App.
        </ShellCaption>
        <TextField
          value={signInHost}
          onChange={(e) => setSignInHost(e.target.value)}
          placeholder="github.com or github.mycompany.com"
          aria-label="GitHub host for sign-in"
        />
        <Button
          variant="accentFill"
          size="sm"
          disabled={oauthSignInDisabled}
          title={
            oauthConfigured === false
              ? 'Browser sign-in is not available in this build — use a token below'
              : undefined
          }
          onClick={() => void startDeviceFlow(signInHost)}
        >
          {deviceBusy ? (
            <Loader2 className={cn(SHELL_ROW_ICON_CLASS, 'animate-spin')} aria-hidden />
          ) : (
            <FolderGit2 className={SHELL_ROW_ICON_CLASS} strokeWidth={SHELL_ROW_ICON_STROKE} aria-hidden />
          )}
          {deviceCode ? `Enter code ${deviceCode}` : 'Sign in with GitHub'}
        </Button>
      </ShellRow>

      {accounts.length > 0 ? (
        <ul className="flex flex-col gap-1 border-t border-border-subtle/30 pt-3">
          {accounts.map((account) => {
            const stale = isGitHubAccountStale(account);
            const verifyBusy = verifyBusyId === account.id;
            return (
              <li
                key={account.id}
                className={cn(
                  'surface-shell flex items-center gap-2 rounded-md px-2 py-1.5',
                  stale && 'ring-1 ring-warning/30'
                )}
              >
                {account.avatarUrl ? (
                  <img
                    src={account.avatarUrl}
                    alt=""
                    className="size-6 rounded-full"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <FolderGit2
                    className={SHELL_ROW_ICON_CLASS}
                    strokeWidth={SHELL_ROW_ICON_STROKE}
                    aria-hidden
                  />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-1.5">
                    <span className="truncate text-row text-text-primary">{account.login}</span>
                    {stale ? (
                      <AlertTriangle
                        className="size-3 shrink-0 text-warning"
                        aria-label="Account needs re-verification"
                      />
                    ) : null}
                  </div>
                  <div className="truncate font-mono text-meta text-text-faint">
                    {account.host} · {account.authKind === 'oauth' ? 'OAuth' : 'PAT'}
                  </div>
                  <div className="truncate text-meta text-text-faint">
                    Verified {formatGitHubVerifiedAt(account.lastVerifiedAt)}
                  </div>
                  {account.verifyStatus === 'error' && account.lastVerifyError ? (
                    <div className="truncate text-meta text-danger" title={account.lastVerifyError}>
                      {account.lastVerifyError}
                    </div>
                  ) : null}
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Re-verify ${account.login}`}
                  title="Re-verify token"
                  disabled={verifyBusy}
                  onClick={() => void verifyAccount(account.id)}
                >
                  {verifyBusy ? (
                    <Loader2 className={cn(SHELL_ROW_ICON_CLASS, 'animate-spin')} aria-hidden />
                  ) : (
                    <RefreshCw className={SHELL_ROW_ICON_CLASS} strokeWidth={SHELL_ROW_ICON_STROKE} />
                  )}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Remove ${account.login}`}
                  onClick={() => void removeAccount(account.id)}
                >
                  <Trash2 className={SHELL_ROW_ICON_CLASS} strokeWidth={SHELL_ROW_ICON_STROKE} />
                </Button>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="vx-settings-empty w-full border-t border-border-subtle/30 pt-3">
          <p className="text-row text-text-muted">No GitHub accounts connected yet.</p>
        </div>
      )}

      <ShellRow className="flex flex-col gap-2 border-t border-border-subtle/30 pt-3">
        <ShellFieldLabel>Or connect with a token</ShellFieldLabel>
        <ShellCaption>
          Paste a personal access token — no OAuth App setup required.{' '}
          <button
            type="button"
            className="text-text-secondary underline decoration-border-subtle underline-offset-2 hover:text-text-primary"
            onClick={openTokenPage}
          >
            Create token on GitHub
          </button>
        </ShellCaption>
        <TextField
          value={patHost}
          onChange={(e) => setPatHost(e.target.value)}
          placeholder="github.com or enterprise host"
          aria-label="GitHub host"
        />
        <TextField
          type="password"
          value={patToken}
          onChange={(e) => setPatToken(e.target.value)}
          placeholder="ghp_… or github_pat_…"
          aria-label="GitHub token"
        />
        <Button variant="secondary" size="sm" disabled={patBusy || !patToken.trim()} onClick={() => void addPat()}>
          {patBusy ? <Loader2 className={SHELL_ROW_ICON_CLASS} aria-hidden /> : null}
          Connect with token
        </Button>
      </ShellRow>

      <GitHubOAuthAdvancedPanel
        oauthClientId={oauthClientId}
        onOauthClientIdChange={setOauthClientId}
        onSaveOAuthClientId={() => void saveOAuthClientId()}
      />
    </ShellSection>
  );
}
