/**
 * Composer banner for local claude-code-proxy — offline / auth warnings with actions.
 */

import { memo, useState } from 'react';
import type { ModelSelection } from '@shared/types/provider.js';
import {
  claudeCodeProxyAuthExpiredMessage,
  claudeCodeProxyOfflineMessage,
  composerProxyBannerLabel,
  isClaudeCodeProxyProvider
} from '@shared/providers/claudeCodeProxy.js';
import { useProviderAccountStore } from '../../store/useProviderAccountStore.js';
import { useProviderStore } from '../../store/useProviderStore.js';
import { Button } from '../ui/Button.js';
import { cn } from '../../lib/cn.js';
import { vyotiq } from '../../lib/ipc.js';

interface ComposerProxyStatusStripProps {
  model: ModelSelection;
}

export const ComposerProxyStatusStrip = memo(function ComposerProxyStatusStrip({
  model
}: ComposerProxyStatusStripProps) {
  const providers = useProviderStore((s) => s.providers);
  const refreshAccounts = useProviderAccountStore((s) => s.refresh);
  const provider = providers.find((p) => p.id === model.providerId);
  const account = useProviderAccountStore((s) => s.snapshotFor(model.providerId));
  const [busy, setBusy] = useState<'idle' | 'start' | 'login'>('idle');

  if (!provider || !isClaudeCodeProxyProvider(provider) || !account?.message) {
    return null;
  }

  const offline = account.status === 'error' || claudeCodeProxyOfflineMessage(account.message);
  const authExpired = claudeCodeProxyAuthExpiredMessage(account.message);
  const bannerLabel = composerProxyBannerLabel(account.message, account.status);
  if (!bannerLabel) return null;

  const runAction = async (action: 'start' | 'login') => {
    setBusy(action);
    try {
      await vyotiq.providers.claudeCodeProxyAction(action);
      await refreshAccounts();
    } finally {
      setBusy('idle');
    }
  };

  return (
    <div
      className={cn(
        'vx-composer-status-strip vx-composer-proxy-banner flex min-w-0 flex-1 items-center gap-2 px-0.5 text-chat-meta',
        offline ? 'text-warning' : 'text-text-secondary'
      )}
      role="status"
      aria-live="polite"
    >
      <span className="min-w-0 flex-1 truncate" title={account.message}>
        {bannerLabel}
      </span>
      {offline ? (
        <Button
          variant="link"
          size="sm"
          className="shrink-0 text-warning"
          loading={busy === 'start'}
          disabled={busy !== 'idle'}
          onClick={() => void runAction('start')}
        >
          Start proxy
        </Button>
      ) : null}
      {authExpired ? (
        <Button
          variant="link"
          size="sm"
          className="shrink-0 text-accent"
          loading={busy === 'login'}
          disabled={busy !== 'idle'}
          onClick={() => void runAction('login')}
        >
          Sign in
        </Button>
      ) : null}
    </div>
  );
});

export function shouldShowComposerProxyBanner(
  model: ModelSelection | null | undefined,
  provider: { baseUrl: string; notes?: string } | undefined,
  account:
    | {
        status?: string;
        message?: string;
      }
    | undefined
): model is ModelSelection {
  if (!model || !provider || !account?.message) return false;
  if (!isClaudeCodeProxyProvider(provider)) return false;
  return (
    account.status === 'error' ||
    claudeCodeProxyOfflineMessage(account.message) ||
    claudeCodeProxyAuthExpiredMessage(account.message)
  );
}
