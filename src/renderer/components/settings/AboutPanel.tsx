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
import { vyotiq } from '../../lib/ipc.js';
import { useToastStore } from '../../store/useToastStore.js';
import { logger } from '../../lib/logger.js';
import {
  SHELL_ROW_ICON_CLASS,
  SHELL_ROW_ICON_STROKE
} from '../../lib/shellIcons.js';
import { cn } from '../../lib/cn.js';

const settingsLog = logger.child('about-panel');

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
  const [updateChecking, setUpdateChecking] = useState(false);
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

  const onReveal = async (target: AppRevealTarget) => {
    try {
      await vyotiq.app.revealPath(target);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast(`Could not open path: ${msg}`, 'danger');
    }
  };

  const onCheckUpdates = async () => {
    setUpdateChecking(true);
    try {
      const result = await vyotiq.app.checkForUpdates();
      if (result.updateAvailable) {
        showToast(
          result.version ? `Update available: v${result.version}` : 'Update available',
          'success'
        );
      } else {
        showToast('You are on the latest version', 'success');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast(`Update check failed: ${msg}`, 'danger');
    } finally {
      setUpdateChecking(false);
    }
  };

  return (
    <section id="settings-about" className="vx-settings-section-anchor px-3 py-2">
      <ShellSection title="About Vyotiq">
        <div className={cn('surface-shell vx-prose', 'px-3 py-2.5')}>
          <p className="vx-row-label">Vyotiq · Agent V</p>
          <p className="vx-row-desc">
            Local-first AI orchestrator with a markdown harness, parallel sub-agents, and direct
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
            <ShellActionRow className="mt-2">
              <Button
                size="sm"
                variant="secondary"
                disabled={updateChecking}
                onClick={() => void onCheckUpdates()}
              >
                {updateChecking ? 'Checking…' : 'Check for updates'}
              </Button>
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
        <ShellCaption>For backup, transfer, or bug reports.</ShellCaption>
        {info ? (
          <div className="vx-settings-path-list mt-2">
            <PathRow
              label="User data"
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
