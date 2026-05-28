import { ProvidersPanel } from './ProvidersPanel.js';
import { MemoryPanel } from './MemoryPanel.js';
import { CheckpointSettingsPanel } from '../checkpoints/CheckpointSettingsPanel.js';
import { ContextPanel } from './ContextPanel.js';
import { describeEndpointWarning } from './endpointWarning.js';
import { useSettingsStore } from '../../store/useSettingsStore.js';
import { useWorkspaceStore } from '../../store/useWorkspaceStore.js';
import { useEffect, useState } from 'react';
import { Button } from '../ui/Button.js';
import { TextField } from '../ui/TextField.js';
import { LoadingHint } from '../ui/LoadingHint.js';
import { Switch } from '../ui/Switch.js';
import { Notice } from '../ui/Notice.js';
import {
  ShellActionRow,
  ShellCaption,
  ShellFieldActions,
  ShellFieldLabel,
  ShellMetaGrid,
  ShellMetaRow,
  ShellRow,
  ShellRowSplit,
  ShellSection,
  ShellStack
} from '../ui/ShellSection.js';
import { LeftSubnav, LeftSubnavLayout, type LeftSubnavItem } from '../ui/LeftSubnav.js';
import {
  chromeGhostRowButtonClassName,
  secondaryZonePanelContentClassName
} from '../ui/SurfaceShell.js';
import {
  SHELL_ROW_ICON_CLASS,
  SHELL_ROW_ICON_STROKE,
  SHELL_TAB_ICON_CLASS,
  SHELL_TAB_ICON_STROKE
} from '../../lib/shellIcons.js';
import {
  Brain,
  Cloud,
  FolderOpen,
  History,
  Info,
  Keyboard,
  Layers,
  Palette,
  RotateCcw,
  ShieldCheck,
  type LucideIcon
} from 'lucide-react';
import { AppearancePanel } from './AppearancePanel.js';
import { ShortcutsPanel } from '../shortcuts/ShortcutsPanel.js';
import type { AppInfo, AppRevealTarget } from '@shared/types/ipc.js';
import { DEFAULT_PERMISSIONS } from '@shared/constants.js';
import { vyotiq } from '../../lib/ipc.js';
import { useToastStore } from '../../store/useToastStore.js';
import { useSecondaryZoneStore } from '../../store/useSecondaryZoneStore.js';
import { logger } from '../../lib/logger.js';
import { cn } from '../../lib/cn.js';
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
  { id: 'appearance', label: 'Appearance', Icon: Palette },
  { id: 'shortcuts', label: 'Shortcuts', Icon: Keyboard },
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

  const navItems: LeftSubnavItem<TabId>[] = TABS.map((t) => ({
    id: t.id,
    label: t.label,
    tabId: `settings-tab-${t.id}`,
    panelId: `settings-panel-${t.id}`,
    icon: <t.Icon className={SHELL_TAB_ICON_CLASS} strokeWidth={SHELL_TAB_ICON_STROKE} aria-hidden />
  }));

  const onTabChange = (next: TabId) => {
    setTab(next);
    persistSettingsTab(next);
  };

  return (
    <LeftSubnavLayout
      className={cn('min-h-0', secondaryZonePanelContentClassName)}
      contentClassName="scrollbar-stealth overflow-y-auto"
      nav={
        <LeftSubnav<TabId>
          items={navItems}
          value={tab}
          onChange={onTabChange}
          ariaLabel="Settings sections"
          footer={
            loading ? (
              <div
                className="mt-2 flex items-center gap-1.5 px-2 text-meta text-text-faint"
                aria-live="polite"
              >
                <LoadingHint message="Syncing…" className="py-2" />
              </div>
            ) : undefined
          }
        />
      }
    >
      <div
        role="tabpanel"
        id={`settings-panel-${tab}`}
        aria-labelledby={`settings-tab-${tab}`}
        className="min-h-0"
      >
        <ShellStack>
          {tab === 'providers' && <ProvidersPanel embedded={embedded} />}
          {tab === 'permissions' && <PermissionsTab />}
          {tab === 'context' && <ContextPanel embedded={embedded} />}
          {tab === 'checkpoints' && <CheckpointSettingsPanel embedded={embedded} />}
          {tab === 'memory' && <MemoryTab embedded={embedded} />}
          {tab === 'appearance' && <AppearancePanel />}
          {tab === 'shortcuts' && <ShortcutsPanel />}
          {tab === 'about' && <AboutTab />}
        </ShellStack>
      </div>
    </LeftSubnavLayout>
  );
}

function PermissionsTab() {
  const settings = useSettingsStore((s) => s.settings);
  const setPermissions = useSettingsStore((s) => s.setPermissions);
  const setEndpoint = useSettingsStore((s) => s.setWebSearchEndpoint);
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeId);
  const workspaces = useWorkspaceStore((s) => s.list);
  const setStrictApprovalsForWorkspace = useSettingsStore(
    (s) => s.setStrictApprovalsForWorkspace
  );
  const setGatePromptOnPendingForWorkspace = useSettingsStore(
    (s) => s.setGatePromptOnPendingForWorkspace
  );
  const setApproveAutoAcceptPendingForWorkspace = useSettingsStore(
    (s) => s.setApproveAutoAcceptPendingForWorkspace
  );
  const setGateReviewRequestChangesForWorkspace = useSettingsStore(
    (s) => s.setGateReviewRequestChangesForWorkspace
  );
  const showToast = useToastStore((s) => s.show);
  const perms = settings.permissions ?? DEFAULT_PERMISSIONS;

  const strictMap = settings.ui?.strictApprovalsByWorkspace ?? {};
  const gateMap = settings.ui?.gatePromptOnPendingByWorkspace ?? {};
  const approveAutoMap = settings.ui?.approveAutoAcceptPendingByWorkspace ?? {};
  const gateReviewMap = settings.ui?.gatePromptOnReviewRequestChangesByWorkspace ?? {};
  const strict = activeWorkspaceId ? strictMap[activeWorkspaceId] === true : false;
  const gatePending = activeWorkspaceId ? gateMap[activeWorkspaceId] === true : false;
  const approveAuto =
    activeWorkspaceId ? approveAutoMap[activeWorkspaceId] !== false : true;
  const gateReview = activeWorkspaceId ? gateReviewMap[activeWorkspaceId] === true : false;
  const activeWorkspace = workspaces.find((w) => w.id === activeWorkspaceId);

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
    <>
      <ShellSection title="Tool permissions">
        <Row
          label="Fully Auto Mode"
          description="When on, gated tool calls (`edit`, `delete`, `bash`, `report`, and `search` mode:web) run without asking for confirmation. When off (default), every such call routes through a confirm prompt so you can approve or deny on the spot. Strict-approvals and the destructive-command gate still run on top regardless."
          value={perms.allowAuto}
          onChange={(v) => void setPermissions({ allowAuto: v })}
        />
        <ShellRow>
          <ShellFieldLabel>Web search endpoint</ShellFieldLabel>
          <ShellCaption>
            Must be <code className="font-mono text-text-secondary">https://</code> —
            <code className="font-mono text-text-secondary"> http://</code> only allowed for localhost.
          </ShellCaption>
          <TextField
            type="text"
            value={endpointDraft}
            onChange={(e) => setEndpointDraft(e.target.value)}
            placeholder="https://example.com/search"
          />
          <ShellFieldActions>
            <Button variant="primary" disabled={!dirty} onClick={() => void onSaveEndpoint()}>
              Save
            </Button>
          </ShellFieldActions>
          {endpointWarning && <Notice tone="warning">{endpointWarning}</Notice>}
        </ShellRow>
      </ShellSection>
      {activeWorkspaceId && (
        <ShellSection title="Checkpoint gates">
          <ShellCaption className="mb-3">
            Controls how unresolved pending checkpoint rows behave when you send a new message in{' '}
            {activeWorkspace?.label ?? 'the active workspace'}. Review rows in Checkpoints before
            sending if you do not want them accepted in bulk.
          </ShellCaption>
          <p className="text-meta text-text-faint mb-3">
            {gatePending
              ? 'Gate on: send is blocked until every pending row is accepted or rejected in Checkpoints.'
              : approveAuto
                ? 'Current: gate off, auto-accept on (default). The next send accepts every pending row before the run starts—often many at once.'
                : 'Current: gate off, auto-accept off. Pending rows stay until you accept or reject them in Checkpoints; send does not clear them.'}
          </p>
          <Row
            label="Require approval before each edit"
            description={`When on, every edit/delete tool call pauses the run for approval before writing to ${activeWorkspace?.label ?? 'the active workspace'}. When off (default), edits apply optimistically and appear in pending changes.`}
            value={strict}
            onChange={(v) => void setStrictApprovalsForWorkspace(activeWorkspaceId, v)}
          />
          <Row
            label="Gate next prompt on pending changes"
            description="When on, send is blocked while this conversation has unresolved pending rows—you must accept or reject each row in Checkpoints first. When off (default), send is not blocked by pending rows."
            value={gatePending}
            onChange={(v) => void setGatePromptOnPendingForWorkspace(activeWorkspaceId, v)}
          />
          <Row
            label="Auto-accept pending on send"
            description="Applies only when the gate above is off. When on (default), your next message accepts every pending row before the run starts. Turn off to leave pending rows untouched until you review them manually. Has no effect while the gate is on."
            value={approveAuto}
            onChange={(v) => void setApproveAutoAcceptPendingForWorkspace(activeWorkspaceId, v)}
          />
          <Row
            label="Gate send on review request changes"
            description="When on, sending is blocked while the latest review session for this conversation has a request-changes decision. Resolve the review in Checkpoints → Review before continuing."
            value={gateReview}
            onChange={(v) => void setGateReviewRequestChangesForWorkspace(activeWorkspaceId, v)}
          />
        </ShellSection>
      )}
      <WorkspaceOverridesSection />
      <CheckpointGateOverridesSection />
    </>
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
    <ShellSection title="Per-workspace overrides">
      <ShellCaption className="mb-3">
        Workspaces below override the global default above. The composer&apos;s &quot;Trust this
        workspace&quot; toggle writes here; reset to fall back to the global value.
      </ShellCaption>
      {overridden.map((w) => {
        const entry = overrideMap[w.id] ?? {};
        const allowAuto = entry.allowAuto;
        const differs = allowAuto !== undefined && allowAuto !== globalPerms.allowAuto;
        return (
          <ShellRow key={w.id}>
            <div className="vx-override">
              <div className="min-w-0">
                <div className="vx-row-label">{w.label}</div>
                <p className="vx-row-desc" title={w.path}>
                  {differs ? (
                    <>
                      <code className="font-mono text-text-secondary">allowAuto</code>:{' '}
                      {allowAuto ? 'on (trusted)' : 'off (always prompt)'}
                    </>
                  ) : (
                    'Override matches global default.'
                  )}
                </p>
              </div>
              <button
                type="button"
                onClick={() => void clearOverride(w.id)}
                title="Reset this workspace to the global default"
                className={chromeGhostRowButtonClassName}
              >
                <RotateCcw className={SHELL_ROW_ICON_CLASS} strokeWidth={SHELL_ROW_ICON_STROKE} />
                Reset
              </button>
            </div>
          </ShellRow>
        );
      })}
    </ShellSection>
  );
}

function CheckpointGateOverridesSection() {
  const settings = useSettingsStore((s) => s.settings);
  const workspaces = useWorkspaceStore((s) => s.list);
  const setStrictApprovalsForWorkspace = useSettingsStore(
    (s) => s.setStrictApprovalsForWorkspace
  );
  const setGatePromptOnPendingForWorkspace = useSettingsStore(
    (s) => s.setGatePromptOnPendingForWorkspace
  );
  const setApproveAutoAcceptPendingForWorkspace = useSettingsStore(
    (s) => s.setApproveAutoAcceptPendingForWorkspace
  );
  const setGateReviewRequestChangesForWorkspace = useSettingsStore(
    (s) => s.setGateReviewRequestChangesForWorkspace
  );
  const strictMap = settings.ui?.strictApprovalsByWorkspace ?? {};
  const gateMap = settings.ui?.gatePromptOnPendingByWorkspace ?? {};
  const approveAutoMap = settings.ui?.approveAutoAcceptPendingByWorkspace ?? {};
  const gateReviewMap = settings.ui?.gatePromptOnReviewRequestChangesByWorkspace ?? {};

  const overridden = workspaces.filter((w) => {
    const strict = strictMap[w.id] === true;
    const gate = gateMap[w.id] === true;
    const approveAutoOff = approveAutoMap[w.id] === false;
    const gateReview = gateReviewMap[w.id] === true;
    return strict || gate || approveAutoOff || gateReview;
  });

  if (overridden.length === 0) return null;

  const onReset = async (workspaceId: string) => {
    await setStrictApprovalsForWorkspace(workspaceId, false);
    await setGatePromptOnPendingForWorkspace(workspaceId, false);
    await setApproveAutoAcceptPendingForWorkspace(workspaceId, true);
    await setGateReviewRequestChangesForWorkspace(workspaceId, false);
  };

  return (
    <ShellSection title="Checkpoint gate overrides">
      <ShellCaption className="mb-3">
        Workspaces below have at least one checkpoint gate turned on. Reset clears all gate flags.
      </ShellCaption>
      {overridden.map((w) => {
        const strict = strictMap[w.id] === true;
        const gate = gateMap[w.id] === true;
        const approveAutoOff = approveAutoMap[w.id] === false;
        const gateReview = gateReviewMap[w.id] === true;
        const labels: string[] = [];
        if (strict) labels.push('strict approvals');
        if (gate) labels.push('gate prompt on pending');
        if (approveAutoOff) labels.push('manual pending accept');
        if (gateReview) labels.push('gate on review changes');
        return (
          <ShellRow key={w.id}>
            <div className="vx-override">
              <div className="min-w-0">
                <div className="vx-row-label">{w.label}</div>
                <p className="vx-row-desc" title={w.path}>
                  {labels.join(', ')}
                </p>
              </div>
              <button
                type="button"
                onClick={() => void onReset(w.id)}
                title="Reset this workspace's checkpoint gate overrides"
                className={chromeGhostRowButtonClassName}
              >
                <RotateCcw className={SHELL_ROW_ICON_CLASS} strokeWidth={SHELL_ROW_ICON_STROKE} />
                Reset
              </button>
            </div>
          </ShellRow>
        );
      })}
    </ShellSection>
  );
}

function Row({
  label,
  description,
  value,
  onChange
}: {
  label: string;
  description: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <ShellRow>
      <ShellRowSplit
        main={
          <>
            <div className="vx-row-label">{label}</div>
            <p className="vx-row-desc">{description}</p>
          </>
        }
        control={<Switch size="md" value={value} onChange={onChange} ariaLabel={label} />}
      />
    </ShellRow>
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
    <>
      <ShellSection title="Product">
        <div className="vx-prose">
          <p className="vx-row-label">Vyotiq · Agent V</p>
          <p className="vx-row-desc">
            A local-first asynchronous AI orchestrator. Vyotiq&apos;s behavior is governed by a
            natural-language harness — markdown files that act as the agent&apos;s operating system.
            The orchestrator decomposes your request, spawns ephemeral single-task sub-agents in
            parallel, verifies their outputs, and synthesizes the result.
          </p>
          <p className="vx-row-desc">
            No SDKs. All AI calls are direct OpenAI-compatible HTTP. API keys are encrypted via your
            OS keychain. File operations are sandboxed to the active workspace.
          </p>
        </div>
      </ShellSection>

      <ShellSection title="Build">
        {info ? (
          <>
            <ShellMetaGrid>
              <ShellMetaRow label="Version" value={info.version} mono />
              <ShellMetaRow label="Electron" value={info.electron} mono />
              <ShellMetaRow label="Node" value={info.node} mono />
            </ShellMetaGrid>
            <ShellActionRow className="mt-3">
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
          <div className="flex items-center gap-2 vx-caption">
            <LoadingHint message="Loading…" className="py-2" />
          </div>
        )}
      </ShellSection>

      <ShellSection title="On-disk paths">
        <ShellCaption className="mb-3">
          Where Vyotiq stores its config, conversations, and rolling logs. Useful for backup,
          transfer, or attaching logs to a bug report.
        </ShellCaption>
        {info ? (
          <>
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
          </>
        ) : loadError ? (
          <ShellCaption>Path info unavailable.</ShellCaption>
        ) : null}
      </ShellSection>
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
    <ShellRow>
      <ShellFieldLabel>{label}</ShellFieldLabel>
      <p className="vx-meta-value-mono break-all">{path}</p>
      <ShellActionRow>
        <Button variant="secondary" onClick={onReveal} title={`Reveal ${label.toLowerCase()}`}>
          <FolderOpen className={SHELL_ROW_ICON_CLASS} strokeWidth={SHELL_ROW_ICON_STROKE} />
          Reveal
        </Button>
      </ShellActionRow>
    </ShellRow>
  );
}

