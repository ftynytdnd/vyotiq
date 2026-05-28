import { ProvidersPanel } from './ProvidersPanel.js';
import { MemoryPanel } from './MemoryPanel.js';
import { CheckpointSettingsPanel } from '../checkpoints/CheckpointSettingsPanel.js';
import { ContextPanel } from './ContextPanel.js';
import { describeEndpointWarning } from './endpointWarning.js';
import { useSettingsStore } from '../../store/useSettingsStore.js';
import { useWorkspaceStore } from '../../store/useWorkspaceStore.js';
import { useEffect, useState } from 'react';
import { Tabs, type TabItem } from '../ui/Tabs.js';
import { Button } from '../ui/Button.js';
import { TextField } from '../ui/TextField.js';
import { Spinner } from '../ui/Spinner.js';
import { Eyebrow } from '../ui/Eyebrow.js';
import { Switch } from '../ui/Switch.js';
import { Notice } from '../ui/Notice.js';
import {
  chromeEdgeClassName,
  chromeGhostRowButtonClassName,
  chromeSettingsInsetRowClassName
} from '../ui/SurfaceShell.js';
import { cn } from '../../lib/cn.js';
import {
  Brain,
  Cloud,
  FolderOpen,
  History,
  Info,
  Layers,
  RotateCcw,
  ShieldCheck,
  type LucideIcon
} from 'lucide-react';
import type { AppInfo, AppRevealTarget } from '@shared/types/ipc.js';
import { DEFAULT_PERMISSIONS } from '@shared/constants.js';
import { vyotiq } from '../../lib/ipc.js';
import { useToastStore } from '../../store/useToastStore.js';
import { useSecondaryZoneStore } from '../../store/useSecondaryZoneStore.js';
import { logger } from '../../lib/logger.js';
import type { SettingsTabId } from '../../store/useSecondaryZoneStore.js';

const settingsLog = logger.child('settings-panel');

type TabId = SettingsTabId;

interface SettingsPanelProps {
  initialTab?: TabId;
  /** When true, uses compact layouts suited to the secondary zone column. */
  embedded?: boolean;
}

const TABS: { id: TabId; label: string; Icon: LucideIcon }[] = [
  { id: 'providers', label: 'Providers', Icon: Cloud },
  { id: 'permissions', label: 'Permissions', Icon: ShieldCheck },
  { id: 'context', label: 'Context', Icon: Layers },
  { id: 'checkpoints', label: 'Checkpoints', Icon: History },
  { id: 'memory', label: 'Memory', Icon: Brain },
  { id: 'about', label: 'About', Icon: Info }
];

/**
 * Settings body — rendered inside the secondary zone.
 */
export function SettingsPanel({ initialTab = 'providers', embedded = false }: SettingsPanelProps) {
  const [tab, setTab] = useState<TabId>(initialTab);
  const loading = useSettingsStore((s) => s.loading);
  const persistSettingsTab = useSecondaryZoneStore((s) => s.setSettingsTab);
  useEffect(() => setTab(initialTab), [initialTab]);

  const tabItems: TabItem<TabId>[] = TABS.map((t) => ({
    id: t.id,
    label: t.label,
    icon: <t.Icon className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
  }));

  const onTabChange = (next: TabId) => {
    setTab(next);
    persistSettingsTab(next);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        className={cn(
          'scrollbar-stealth flex shrink-0 items-center border-b pb-2',
          chromeEdgeClassName,
          embedded ? 'gap-1 overflow-x-auto' : 'flex-wrap gap-1'
        )}
      >
        <Tabs<TabId>
          items={tabItems}
          value={tab}
          onChange={onTabChange}
          stripNav
          stripCompact={embedded}
          ariaLabel="Settings sections"
          className={embedded ? 'min-w-0 flex-1' : undefined}
        />
        {loading && (
          <div
            className="ml-auto flex shrink-0 items-center gap-1.5 self-center px-1 text-meta text-text-faint"
            aria-live="polite"
          >
            <Spinner /> Syncing…
          </div>
        )}
      </div>
      <div className="min-h-0 flex-1 pt-3">
        {tab === 'providers' && <ProvidersPanel embedded={embedded} />}
        {tab === 'permissions' && <PermissionsTab embedded={embedded} />}
        {tab === 'context' && <ContextPanel embedded={embedded} />}
        {tab === 'checkpoints' && <CheckpointSettingsPanel embedded={embedded} />}
        {tab === 'memory' && <MemoryTab embedded={embedded} />}
        {tab === 'about' && <AboutTab />}
      </div>
    </div>
  );
}

function PermissionsTab({ embedded = false }: { embedded?: boolean }) {
  const settings = useSettingsStore((s) => s.settings);
  const setPermissions = useSettingsStore((s) => s.setPermissions);
  const setEndpoint = useSettingsStore((s) => s.setWebSearchEndpoint);
  const showToast = useToastStore((s) => s.show);
  const perms = settings.permissions ?? DEFAULT_PERMISSIONS;

  const persisted = settings.webSearchEndpoint ?? '';
  const [endpointDraft, setEndpointDraft] = useState(persisted);
  useEffect(() => setEndpointDraft(persisted), [persisted]);
  const dirty = endpointDraft.trim() !== persisted.trim();

  const onSaveEndpoint = async () => {
    const next = endpointDraft.trim();
    try {
      await setEndpoint(next);
      // Distinguish cleared-vs-saved so the toast text matches what the
      // user actually did. An empty save persists `''` (the existing
      // validator and the main-side `search` tool both treat `''` as
      // "unset"); the toast just relabels that case.
      showToast(
        next.length === 0 ? 'Web search endpoint cleared' : 'Web search endpoint saved',
        'success'
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast(`Save failed: ${msg}`, 'danger');
    }
  };

  // Live diagnostic for the persisted endpoint, mirroring the rules the
  // main-process `search` tool enforces. Surfacing this in the settings
  // pane stops the only feedback loop a user previously got — a runtime
  // tool-result with `insecure scheme` or `no endpoint`. Web search is
  // always reachable under the new model (it either auto-runs under
  // `allowAuto` or prompts the user), so the "empty endpoint" warning
  // fires whenever the user has indicated intent by toggling auto on.
  const endpointWarning = describeEndpointWarning(perms.allowAuto, persisted);

  return (
    <div className="flex flex-col">
      <Row
        label="Fully Auto Mode"
        description="When on, gated tool calls (`edit`, `delete`, `bash`, `report`, and `search` mode:web) run without asking for confirmation. When off (default), every such call routes through a confirm prompt so you can approve or deny on the spot. Strict-approvals and the destructive-command gate still run on top regardless."
        value={perms.allowAuto}
        onChange={(v) => void setPermissions({ allowAuto: v })}
        compact={embedded}
      />
      <div className="mt-4 flex flex-col gap-1.5 border-t border-border-subtle/40 pt-4">
        <Eyebrow as="label" bold>
          Web search endpoint
        </Eyebrow>
        <div className="text-row text-text-muted">
          Must be <code className="font-mono text-text-secondary">https://</code> —
          <code className="font-mono text-text-secondary"> http://</code> only allowed for localhost.
        </div>
        <div className={cn('mt-1 flex gap-2', embedded ? 'flex-col' : 'items-center')}>
          <TextField
            type="text"
            value={endpointDraft}
            onChange={(e) => setEndpointDraft(e.target.value)}
            placeholder="https://example.com/search"
            size="md"
            tone="base"
            className="min-w-0 flex-1 px-3 text-row transition-colors duration-150 focus:bg-surface-hover/40"
          />
          <Button
            size="sm"
            variant={dirty ? 'primary' : 'secondary'}
            disabled={!dirty}
            className={embedded ? 'self-start' : undefined}
            onClick={() => void onSaveEndpoint()}
          >
            Save
          </Button>
        </div>
        {endpointWarning && (
          <Notice tone="warning" className="mt-2">
            {endpointWarning}
          </Notice>
        )}
      </div>
      <WorkspaceOverridesSection />
    </div>
  );
}

/**
 * Per-workspace permission overrides — surfaces every workspace that
 * has the single `allowAuto` flag overridden against the global
 * default. Each row exposes a one-click reset. Hidden entirely when
 * no workspace has any override, so a typical user never sees this
 * section at all.
 */
function WorkspaceOverridesSection() {
  const settings = useSettingsStore((s) => s.settings);
  const workspaces = useWorkspaceStore((s) => s.list);
  const clearOverride = useSettingsStore((s) => s.clearWorkspacePermissions);
  const overrideMap = settings.ui?.permissionsByWorkspace ?? {};
  const overridden = workspaces.filter(
    (w) => Object.keys(overrideMap[w.id] ?? {}).length > 0
  );
  // Hide the whole block when nothing is overridden — keeps the
  // panel clean for the common single-workspace user.
  if (overridden.length === 0) return null;

  const globalPerms = { ...DEFAULT_PERMISSIONS, ...(settings.permissions ?? {}) };

  return (
    <div className="mt-6 flex flex-col gap-2 border-t border-border-subtle/40 pt-4">
      <Eyebrow as="span" bold>
        Per-workspace overrides
      </Eyebrow>
      <div className="text-row text-text-muted">
        Workspaces below override the global default above. The
        composer's "Trust this workspace" toggle writes here; reset to
        fall back to the global value.
      </div>
      <ul className="mt-2 flex flex-col gap-1">
        {overridden.map((w) => {
          const entry = overrideMap[w.id] ?? {};
          // The override map only carries `allowAuto` now. Compute the
          // human-readable label off the (possibly absent) entry value.
          const allowAuto = entry.allowAuto;
          const differs = allowAuto !== undefined && allowAuto !== globalPerms.allowAuto;
          return (
            <li
              key={w.id}
              className={cn(
                chromeSettingsInsetRowClassName,
                'flex items-start justify-between gap-3'
              )}
            >
              <div className="min-w-0 flex-1">
                <div className="text-row text-text-primary">{w.label}</div>
                <div className="mt-0.5 text-meta text-text-muted" title={w.path}>
                  {differs ? (
                    <>
                      <code className="font-mono text-text-secondary">allowAuto</code>:{' '}
                      {allowAuto ? 'on (trusted)' : 'off (always prompt)'}
                    </>
                  ) : (
                    'Override matches global default.'
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={() => void clearOverride(w.id)}
                title="Reset this workspace to the global default"
                className={chromeGhostRowButtonClassName}
              >
                <RotateCcw className="h-3.5 w-3.5" strokeWidth={2.25} />
                <span>Reset</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Row({
  label,
  description,
  value,
  onChange,
  compact = false
}: {
  label: string;
  description: string;
  value: boolean;
  onChange: (v: boolean) => void;
  compact?: boolean;
}) {
  // Trailing control is the shared `Switch` primitive (md size) — the
  // composer's PermissionsMenu uses the same primitive at sm size, so
  // both surfaces now share a single visual + a11y contract instead
  // of pairing an iOS pill in one place with an On/Off button in the
  // other. The Switch carries `role="switch"` + `aria-checked`; the
  // visible label text provides the accessible name through
  // `ariaLabel`.
  return (
    <div
      className={cn(
        'border-b border-border-subtle/30 py-3 last:border-b-0',
        compact ? 'flex flex-col gap-3' : 'flex items-start justify-between gap-4'
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="text-body text-text-primary">{label}</div>
        <div className="mt-0.5 text-row leading-relaxed text-text-muted">{description}</div>
      </div>
      <Switch size="md" value={value} onChange={onChange} ariaLabel={label} />
    </div>
  );
}

function MemoryTab({ embedded }: { embedded?: boolean }) {
  return <MemoryPanel layout={embedded ? 'stack' : 'split'} />;
}

/**
 * About tab — static product description PLUS the read-only `AppInfo`
 * snapshot fetched from `vyotiq.app.info()`. The paths section lets a
 * user (or anyone helping with support / backup) find their settings,
 * userData folder, and rolling log file without digging through
 * Electron's userData conventions. Each path row has a Reveal button
 * that opens the location in the OS file manager — the underlying IPC
 * (`APP_REVEAL_PATH`) accepts only the three whitelisted enum targets,
 * never arbitrary strings, so the channel can't be abused.
 *
 * Visual contract: this tab strictly reuses the same tokens already in
 * use elsewhere in the modal (`text-body`, `text-row`, `text-meta`,
 * `font-mono`, `border-border-subtle/30`, `Button size="sm"
 * variant="ghost"` with `FolderOpen`) — no new card chrome, no new
 * design language.
 */
function AboutTab() {
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
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
        settingsLog.warn('app.info failed; About tab paths will be unavailable', {
          err: msg
        });
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

  return (
    <div className="flex flex-col gap-4">
      <div className="space-y-3 text-row leading-relaxed text-text-muted">
        <div className="text-body font-semibold text-text-primary">Vyotiq · Agent V</div>
        <p>
          A local-first asynchronous AI orchestrator. Vyotiq's behavior is governed by a natural-
          language harness — markdown files that act as the agent's operating system. The
          orchestrator decomposes your request, spawns ephemeral single-task sub-agents in parallel,
          verifies their outputs, and synthesizes the result.
        </p>
        <p>
          No SDKs. All AI calls are direct OpenAI-compatible HTTP. API keys are encrypted via your
          OS keychain. File operations are sandboxed to the active workspace.
        </p>
      </div>

      <div className="flex flex-col gap-2 border-t border-border-subtle/30 pt-4">
        <Eyebrow as="span" bold>
          Build
        </Eyebrow>
        {info ? (
          <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-row">
            <InfoRow label="Version" value={info.version} />
            <InfoRow label="Electron" value={info.electron} />
            <InfoRow label="Node" value={info.node} />
          </dl>
        ) : loadError ? (
          <div className="text-row text-text-muted">Build info unavailable: {loadError}</div>
        ) : (
          <div className="flex items-center gap-2 text-row text-text-muted">
            <Spinner /> Loading…
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2 border-t border-border-subtle/30 pt-4">
        <Eyebrow as="span" bold>
          On-disk paths
        </Eyebrow>
        <div className="text-row text-text-muted">
          Where Vyotiq stores its config, conversations, and rolling logs. Useful for backup,
          transfer, or attaching logs to a bug report.
        </div>
        {info ? (
          <div className="flex flex-col">
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
          <div className="text-row text-text-muted">Path info unavailable.</div>
        ) : null}
      </div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-text-faint">{label}</dt>
      <dd className="truncate font-mono text-text-secondary">{value || '—'}</dd>
    </>
  );
}

/**
 * One path row inside the About → On-disk paths block. The label sits
 * on top of the monospace path (so a long path can wrap onto a second
 * line without crowding the label), and the Reveal button mirrors the
 * exact shape used by `MemoryPanel`'s Reveal action: `Button size="sm"
 * variant="ghost"` + `FolderOpen` icon. No new styling primitives.
 */
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
    <div className="flex flex-col gap-2 border-b border-border-subtle/30 py-3 last:border-b-0">
      <Eyebrow>{label}</Eyebrow>
      <div className="break-all font-mono text-row leading-relaxed text-text-secondary">{path}</div>
      <Button
        size="sm"
        variant="ghost"
        className="self-start"
        onClick={onReveal}
        title={`Reveal ${label.toLowerCase()}`}
      >
        <FolderOpen className="h-3.5 w-3.5" strokeWidth={2.25} />
        Reveal
      </Button>
    </div>
  );
}

