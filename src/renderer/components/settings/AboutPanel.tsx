import { useEffect, useState } from 'react';
import { FolderOpen } from 'lucide-react';
import { Button } from '../ui/Button.js';
import { LoadingHint } from '../ui/LoadingHint.js';
import {
  ShellActionRow,
  ShellCaption,
  ShellFieldLabel,
  ShellMetaGrid,
  ShellMetaRow,
  ShellRow,
  ShellSection
} from '../ui/ShellSection.js';
import type { AppInfo, AppRevealTarget } from '@shared/types/ipc.js';
import type { AppUpdateStatus } from '@shared/types/appUpdate.js';
import { vyotiq } from '../../lib/ipc.js';
import { useToastStore } from '../../store/useToastStore.js';
import { logger } from '../../lib/logger.js';
import {
  SHELL_ROW_ICON_CLASS,
  SHELL_ROW_ICON_STROKE
} from '../../lib/shellIcons.js';
import { cn } from '../../lib/cn.js';

const settingsLog = logger.child('about-panel');

function updateStatusLabel(status: AppUpdateStatus): string | null {
  switch (status.phase) {
    case 'idle':
      return null;
    case 'checking':
      return 'Checking for updates…';
    case 'available':
      return status.version ? `Update available: v${status.version}` : 'Update available';
    case 'not-available':
      return 'You are on the latest version';
    case 'downloading':
      return status.percent !== undefined
        ? `Downloading update… ${status.percent}%`
        : 'Downloading update…';
    case 'downloaded':
      return status.version
        ? `Update v${status.version} ready to install`
        : 'Update ready to install';
    case 'error':
      return status.error ? `Update error: ${status.error}` : 'Update check failed';
    default: {
      const _exhaustive: never = status.phase;
      return String(_exhaustive);
    }
  }
}

function PathRow({
  label,
  path,
  onReveal
}: {
  label: string;
  path: string;
  onReveal: () => void;
}) {
  return (
    <div className="vx-settings-path-row">
      <ShellFieldLabel>{label}</ShellFieldLabel>
      <p className="vx-meta-value-mono break-all text-row text-text-secondary">{path}</p>
      <Button
        variant="ghost"
        size="sm"
        onClick={onReveal}
        title={`Reveal ${label.toLowerCase()}`}
      >
        <FolderOpen className={SHELL_ROW_ICON_CLASS} strokeWidth={SHELL_ROW_ICON_STROKE} />
        Reveal
      </Button>
    </div>
  );
}

export function AboutPanel() {
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [updateStatus, setUpdateStatus] = useState<AppUpdateStatus>({ phase: 'idle' });
  const [updateBusy, setUpdateBusy] = useState(false);
  const showToast = useToastStore((s) => s.show);

  useEffect(() => {
    let cancelled = false;
    void vyotiq.app
      .info()
      .then((next) => {
        if (cancelled) return;
        setInfo(next);
        setLoadError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : String(err);
        settingsLog.warn('app.info failed; About paths unavailable', { err: msg });
        setLoadError(msg);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    return vyotiq.app.onUpdateStatus((status) => {
      setUpdateStatus(status);
    });
  }, []);

  const onReveal = async (target: AppRevealTarget) => {
    try {
      await vyotiq.app.revealPath(target);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast(`Could not open path: ${msg}`, 'danger');
    }
  };

  const onCheckUpdates = async () => {
    setUpdateBusy(true);
    try {
      const result = await vyotiq.app.checkForUpdates();
      setUpdateStatus(result.status);
      if (result.updateAvailable) {
        showToast(
          result.version ? `Update available: v${result.version}` : 'Update available',
          'success'
        );
      } else if (result.status.phase === 'not-available') {
        showToast('You are on the latest version', 'success');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast(`Update check failed: ${msg}`, 'danger');
    } finally {
      setUpdateBusy(false);
    }
  };

  const onInstallUpdate = async () => {
    setUpdateBusy(true);
    try {
      await vyotiq.app.installUpdate();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast(`Could not install update: ${msg}`, 'danger');
      setUpdateBusy(false);
    }
  };

  const statusLine = updateStatusLabel(updateStatus);
  const canInstall = updateStatus.phase === 'downloaded';

  return (
    <section id="settings-about" className="vx-settings-section-anchor px-3 py-2">
      <ShellSection>
        <div className={cn('surface-shell vx-prose', 'px-3 py-2.5')}>
          <p className="vx-row-label">Vyotiq · Agent V</p>
          <p className="vx-row-desc">
            Local-first AI orchestrator with a markdown harness, a single dynamic Agent V, and direct
            OpenAI-compatible HTTP — no SDKs. Keys use your OS keychain; files stay in the active
            workspace.
          </p>
        </div>

        <h4 className="vx-settings-subhead">Build</h4>
        {info ? (
          <>
            <div className="surface-shell vx-settings-build-card">
              <ShellMetaGrid>
                <ShellMetaRow label="Version" value={info.version} mono />
                <ShellMetaRow label="Electron" value={info.electron} mono />
                <ShellMetaRow label="Node" value={info.node} mono />
              </ShellMetaGrid>
            </div>
            {statusLine ? (
              <ShellCaption className="mt-2">{statusLine}</ShellCaption>
            ) : null}
            <ShellActionRow className="mt-2">
              <Button
                size="sm"
                variant="secondary"
                disabled={updateBusy || updateStatus.phase === 'downloading'}
                onClick={() => void onCheckUpdates()}
              >
                {updateBusy && updateStatus.phase !== 'downloaded'
                  ? 'Checking…'
                  : 'Check for updates'}
              </Button>
              {canInstall ? (
                <Button
                  size="sm"
                  variant="primary"
                  disabled={updateBusy}
                  onClick={() => void onInstallUpdate()}
                >
                  Install & restart
                </Button>
              ) : null}
            </ShellActionRow>
          </>
        ) : loadError ? (
          <ShellCaption>Build info unavailable: {loadError}</ShellCaption>
        ) : (
          <ShellRow className="py-0">
            <LoadingHint message="Loading build info…" className="py-2" size={12} />
          </ShellRow>
        )}

        <h4 className="vx-settings-subhead">On-disk paths</h4>
        <ShellCaption>
          Vyotiq data lives under <code className="font-mono">vyotiq/</code> inside the Electron
          profile folder. Chromium caches (Cache/, GPUCache/, …) stay in the profile root.
        </ShellCaption>
        {info ? (
          <div className="vx-settings-path-list mt-2">
            <PathRow
              label="Vyotiq data"
              path={info.userDataDir}
              onReveal={() => void onReveal('userData')}
            />
            <PathRow
              label="Settings file"
              path={info.settingsFile}
              onReveal={() => void onReveal('settings')}
            />
            <PathRow
              label="Log directory"
              path={info.logDir}
              onReveal={() => void onReveal('log')}
            />
          </div>
        ) : loadError ? (
          <ShellCaption className="mt-2">Path info unavailable.</ShellCaption>
        ) : null}
      </ShellSection>
    </section>
  );
}
