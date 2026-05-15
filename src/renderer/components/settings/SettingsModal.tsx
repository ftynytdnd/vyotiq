import { Modal } from '../ui/Modal.js';
import { ProvidersPanel } from './ProvidersPanel.js';
import { MemoryPanel } from './MemoryPanel.js';
import { CheckpointSettingsPanel } from '../checkpoints/CheckpointSettingsPanel.js';
import { describeEndpointWarning } from './endpointWarning.js';
import { useSettingsStore } from '../../store/useSettingsStore.js';
import { useProviderStore } from '../../store/useProviderStore.js';
import { useWorkspaceStore } from '../../store/useWorkspaceStore.js';
import { useEffect, useMemo, useState } from 'react';
import { Button } from '../ui/Button.js';
import { Dropdown, type DropdownItem } from '../ui/Dropdown.js';
import { TextField } from '../ui/TextField.js';
import { Spinner } from '../ui/Spinner.js';
import { Eyebrow } from '../ui/Eyebrow.js';
import { cn } from '../../lib/cn.js';
import { formatTokenCount } from '../../lib/formatTokens.js';
import { FolderOpen, RotateCcw } from 'lucide-react';
import type { AppInfo, AppRevealTarget } from '@shared/types/ipc.js';
import { DEFAULT_PERMISSIONS } from '@shared/constants.js';
import { vyotiq } from '../../lib/ipc.js';
import { useToastStore } from '../../store/useToastStore.js';
import { logger } from '../../lib/logger.js';

const settingsLog = logger.child('settings-modal');

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
  initialTab?: TabId;
}

type TabId =
  | 'providers'
  | 'permissions'
  | 'performance'
  | 'checkpoints'
  | 'memory'
  | 'about';

const TABS: { id: TabId; label: string }[] = [
  { id: 'providers', label: 'Providers' },
  { id: 'permissions', label: 'Permissions' },
  { id: 'performance', label: 'Performance' },
  { id: 'checkpoints', label: 'Checkpoints' },
  { id: 'memory', label: 'Memory' },
  { id: 'about', label: 'About' }
];

export function SettingsModal({ open, onClose, initialTab = 'providers' }: SettingsModalProps) {
  const [tab, setTab] = useState<TabId>(initialTab);
  const loading = useSettingsStore((s) => s.loading);
  useEffect(() => setTab(initialTab), [initialTab, open]);

  return (
    <Modal open={open} onClose={onClose} title="Settings" size="lg">
      <div className="-mx-5 -mb-5 flex min-h-[520px]">
        <nav
          className={cn(
            'w-44 shrink-0 border-r border-border-subtle/40 pb-4 pr-1 pt-1',
            'flex flex-col gap-0.5'
          )}
        >
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={cn(
                'log-line app-no-drag flex w-full items-center rounded-inner px-3 py-1.5 text-left text-log',
                'transition-colors duration-150',
                tab === t.id
                  ? 'bg-surface-overlay text-text-primary'
                  : 'text-text-muted hover:text-text-primary'
              )}
            >
              {t.label}
            </button>
          ))}
          {loading && (
            <div
              className="mt-auto flex items-center gap-1.5 px-3 pt-3 text-meta text-text-faint"
              aria-live="polite"
            >
              <Spinner size={12} /> Syncing…
            </div>
          )}
        </nav>
        <div className="min-w-0 flex-1 overflow-y-auto px-5 py-4">
          {tab === 'providers' && <ProvidersPanel />}
          {tab === 'permissions' && <PermissionsTab />}
          {tab === 'performance' && <PerformanceTab />}
          {tab === 'checkpoints' && <CheckpointSettingsPanel />}
          {tab === 'memory' && <MemoryTab />}
          {tab === 'about' && <AboutTab />}
        </div>
      </div>
    </Modal>
  );
}

function PermissionsTab() {
  const settings = useSettingsStore((s) => s.settings);
  const setPermissions = useSettingsStore((s) => s.setPermissions);
  const setEndpoint = useSettingsStore((s) => s.setWebSearchEndpoint);
  const showToast = useToastStore((s) => s.show);
  const perms = settings.permissions ?? {
    allowFileWrites: true,
    allowBash: true,
    allowWebSearch: false
  };

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
  // tool-result with `insecure scheme` or `no endpoint`.
  const endpointWarning = describeEndpointWarning(perms.allowWebSearch, persisted);

  return (
    <div className="flex flex-col">
      <DefaultModelRow />
      <Row
        label="Allow file writes"
        description="Lets Agent V create/edit files via the `edit` tool. Disabling triggers a confirmation prompt for each write."
        value={perms.allowFileWrites}
        onChange={(v) => void setPermissions({ allowFileWrites: v })}
      />
      <Row
        label="Allow shell commands"
        description="Lets Agent V run commands via the `bash` tool (PowerShell on Windows). Destructive commands always require confirmation regardless."
        value={perms.allowBash}
        onChange={(v) => void setPermissions({ allowBash: v })}
      />
      <Row
        label="Allow web search"
        description="Off by default for privacy. When enabled, only the user's plain query is sent to the configured endpoint — never file contents."
        value={perms.allowWebSearch}
        onChange={(v) => void setPermissions({ allowWebSearch: v })}
      />
      <div className="mt-4 flex flex-col gap-1.5 border-t border-border-subtle/40 pt-4">
        <Eyebrow as="label" bold>
          Web search endpoint
        </Eyebrow>
        <div className="text-row text-text-muted">
          Must be <code className="font-mono text-text-secondary">https://</code> —
          <code className="font-mono text-text-secondary"> http://</code> only allowed for localhost.
        </div>
        <div className="mt-1 flex items-center gap-2">
          <TextField
            type="text"
            value={endpointDraft}
            onChange={(e) => setEndpointDraft(e.target.value)}
            placeholder="https://example.com/search"
            size="md"
            tone="base"
            className="flex-1 px-3 text-log transition-colors duration-150 focus:bg-surface-overlay"
          />
          <Button
            size="sm"
            variant={dirty ? 'primary' : 'secondary'}
            disabled={!dirty}
            onClick={() => void onSaveEndpoint()}
          >
            Save
          </Button>
        </div>
        {endpointWarning && (
          <div
            role="alert"
            className="mt-2 rounded-inner bg-warning/5 px-3 py-2 text-row leading-relaxed text-warning"
          >
            {endpointWarning}
          </div>
        )}
      </div>
      <WorkspaceOverridesSection />
    </div>
  );
}

/**
 * Per-workspace permission overrides — surfaces every workspace that
 * has a non-default override on top of the global block. Each row
 * shows the diff between effective + global flags and exposes a
 * one-click reset. Hidden entirely when no workspace has any
 * override, so a typical user never sees this section at all.
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
        Workspaces below override the global defaults above. Toggling a
        permission while a workspace is active scopes the change to that
        workspace; reset to fall back to the global value.
      </div>
      <ul className="mt-2 flex flex-col gap-1">
        {overridden.map((w) => {
          const entry = overrideMap[w.id] ?? {};
          // Render only the flags that actually differ from the global
          // — a "{}" override (after toggle-back) shouldn't crowd the
          // panel with three identical rows.
          const diffs = (Object.entries(entry) as [
            keyof typeof DEFAULT_PERMISSIONS,
            boolean
          ][]).filter(([k, v]) => globalPerms[k] !== v);
          return (
            <li
              key={w.id}
              className="flex items-start justify-between gap-3 rounded-inner bg-surface-base/30 px-3 py-2"
            >
              <div className="min-w-0 flex-1">
                <div className="text-row text-text-primary">{w.label}</div>
                <div className="mt-0.5 text-meta text-text-muted" title={w.path}>
                  {diffs.length === 0 ? (
                    'Override matches global defaults.'
                  ) : (
                    diffs.map(([k, v]) => (
                      <span key={k} className="mr-3">
                        <code className="font-mono text-text-secondary">{k}</code>:{' '}
                        {v ? 'on' : 'off'}
                      </span>
                    ))
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={() => void clearOverride(w.id)}
                title="Reset this workspace to the global default"
                className="inline-flex h-8 items-center gap-1.5 rounded-inner px-2.5 text-row text-text-muted transition-colors duration-150 hover:bg-surface-hover hover:text-text-primary"
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

/**
 * DefaultModelRow — persists the user's preferred default (provider, model)
 * selection via `useSettingsStore.setDefaultModel`. The composer and new
 * conversations fall back to this when the active conversation has no
 * previously-used model recorded. Built with the shared `Dropdown`
 * primitive so grouping + description rendering stay consistent with the
 * rest of the app.
 *
 * The dropdown value is a synthetic `providerId::modelId` string because
 * `Dropdown`'s generic is constrained to `string`; we split on the way out.
 */
function DefaultModelRow() {
  const providers = useProviderStore((s) => s.providers);
  const def = useSettingsStore((s) => s.settings.defaultModel);
  const setDefaultModel = useSettingsStore((s) => s.setDefaultModel);

  const items: DropdownItem<string>[] = useMemo(() => {
    const out: DropdownItem<string>[] = [];
    for (const p of providers) {
      if (!p.enabled) continue;
      const models = p.models ?? [];
      for (const m of models) {
        out.push({
          value: `${p.id}::${m.id}`,
          label: m.id,
          ...(typeof m.contextWindow === 'number'
            ? { description: `${formatTokenCount(m.contextWindow)} context` }
            : {}),
          group: p.name
        });
      }
    }
    return out;
  }, [providers]);

  const currentValue = def ? `${def.providerId}::${def.modelId}` : null;
  // Guard: only keep `currentValue` selected if the underlying provider /
  // model is still enabled + discovered. Otherwise the dropdown shows its
  // placeholder instead of a stale id.
  const resolvedValue =
    currentValue && items.some((i) => i.value === currentValue) ? currentValue : null;

  return (
    <div className="flex items-start justify-between gap-4 border-b border-border-subtle/30 py-3">
      <div className="min-w-0 flex-1">
        <div className="text-body text-text-primary">Default model</div>
        <div className="mt-0.5 text-row leading-relaxed text-text-muted">
          Used when starting a fresh conversation or when the previously-selected model
          is no longer available. Populated from every enabled provider's discovered
          models.
        </div>
      </div>
      <Dropdown<string>
        items={items}
        value={resolvedValue}
        placeholder={items.length === 0 ? 'No models available' : 'Select model…'}
        disabled={items.length === 0}
        onChange={(composed) => {
          const idx = composed.indexOf('::');
          if (idx === -1) return;
          const providerId = composed.slice(0, idx);
          const modelId = composed.slice(idx + 2);
          void setDefaultModel({ providerId, modelId });
        }}
      />
    </div>
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
    <div className="flex items-start justify-between gap-4 border-b border-border-subtle/30 py-3 last:border-b-0">
      <div className="min-w-0 flex-1">
        <div className="text-body text-text-primary">{label}</div>
        <div className="mt-0.5 text-row leading-relaxed text-text-muted">{description}</div>
      </div>
      <Button size="sm" variant={value ? 'primary' : 'secondary'} onClick={() => onChange(!value)}>
        {value ? 'On' : 'Off'}
      </Button>
    </div>
  );
}

function MemoryTab() {
  return <MemoryPanel />;
}

/**
 * PerformanceTab — settings that affect how the orchestrator handles
 * very long sessions. Right now there's a single toggle here
 * (`historySummary.enabled`); the tab exists as a dedicated home so
 * future perf-leaning settings (token-budget caps, retry policy
 * tuning, parallel-delegate concurrency) have a natural place to land
 * without crowding the safety-focused Permissions tab.
 *
 * Safety vs performance is a real ontological split: Permissions
 * answers "is the agent allowed to do X?", Performance answers "how
 * does the agent behave when context / time / cost gets tight?". A
 * user reasoning about either question shouldn't have to wade through
 * the other.
 */
function PerformanceTab() {
  const settings = useSettingsStore((s) => s.settings);
  const setHistorySummary = useSettingsStore((s) => s.setHistorySummaryEnabled);
  const enabled = settings.historySummary?.enabled === true;

  return (
    <div className="flex flex-col">
      <Row
        label="Summarize old turns on long sessions"
        description={
          // Plain-language description — the audit-fix vocabulary
          // ("§2.2", "trim policy", "post-trim history") belongs in
          // the codebase, not in the user-facing copy. The user only
          // needs to know: this trades a small extra LLM call against
          // the cost of repeated context-overflow rejections on very
          // long delegate-heavy chats.
          'On very long conversations, Agent V may struggle to fit the full history into the model\'s context window. ' +
          'When enabled, the orchestrator falls back to a single summarizer call that compacts the oldest half of the ' +
          'transcript before resuming. Off by default; enable for marathon sessions where you see repeated ' +
          'context-overflow errors. Takes effect on the next message.'
        }
        value={enabled}
        onChange={(v) => void setHistorySummary(v)}
      />
    </div>
  );
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
            <Spinner size={12} /> Loading…
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
    <div className="flex items-center justify-between gap-3 border-b border-border-subtle/30 py-2 last:border-b-0">
      <div className="min-w-0 flex-1">
        <div className="text-meta uppercase tracking-wider text-text-faint">{label}</div>
        <div className="mt-0.5 break-all font-mono text-row text-text-secondary">{path}</div>
      </div>
      <Button size="sm" variant="ghost" onClick={onReveal} title={`Reveal ${label.toLowerCase()}`}>
        <FolderOpen className="h-3.5 w-3.5" strokeWidth={2.25} />
        Reveal
      </Button>
    </div>
  );
}
