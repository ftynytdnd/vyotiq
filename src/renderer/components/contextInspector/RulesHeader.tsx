/**
 * Flat rules form for the Context Inspector / Settings → Context tab.
 *
 * Visual contract: mirrors the row pattern in Settings → Permissions
 * and `CheckpointSettingsPanel` —
 *
 *     <div className="flex items-start justify-between gap-4
 *                     border-b border-border-subtle/30 py-3">
 *       <div className="min-w-0 flex-1">
 *         <div className="text-body text-text-primary">{label}</div>
 *         <div className="mt-0.5 text-row leading-relaxed
 *                         text-text-muted">{description}</div>
 *       </div>
 *       <Button size="sm" variant={...} />
 *     </div>
 *
 * No collapsible chevron, no nested cards, no ad-hoc segmented
 * controls — every interactive surface is a `Button size="sm"` or
 * the shared `Dropdown` / `TextField` / `Eyebrow` primitives. Save
 * is auto-persist per row (mirrors how Permissions toggles save
 * straight to settings on click) so the user never has a "Save"
 * button to find or a "dirty" state to track.
 *
 * The component takes a `defaultScope` and writes through that
 * scope by default. The active workspace's row is rendered
 * separately — ContextPanel below the global form, Inspector inside
 * the same panel — by toggling `defaultScope`. There is NO second
 * "save as workspace" button here; that decision is encoded in
 * `defaultScope` at the call site.
 */

import { useEffect, useMemo, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import type {
  ContextMessageKindPolicy,
  ContextSummaryRules,
  DroppedMarkerStyle,
  MessageKind
} from '@shared/types/contextSummary.js';
import { DEFAULT_CONTEXT_SUMMARY_RULES } from '@shared/types/contextSummary.js';
import type { ModelSelection } from '@shared/types/provider.js';
import { Button } from '../ui/Button.js';
import { Dropdown, type DropdownItem } from '../ui/Dropdown.js';
import { Eyebrow } from '../ui/Eyebrow.js';
import { Switch } from '../ui/Switch.js';
import { TextField } from '../ui/TextField.js';
import { useContextSummaryStore } from '../../store/useContextSummaryStore.js';
import { useProviderStore } from '../../store/useProviderStore.js';
import { useToastStore } from '../../store/useToastStore.js';
import { cn } from '../../lib/cn.js';
import { labelForKind } from './inspectorFormat.js';

const KIND_ROWS: ReadonlyArray<MessageKind> = [
  'user',
  'assistant',
  'assistant-tool-call',
  'tool-result',
  'delegate-result',
  'system-summary'
];

const POLICY_OPTIONS: ReadonlyArray<{ value: ContextMessageKindPolicy; label: string }> = [
  { value: 'auto', label: 'Auto' },
  { value: 'keep', label: 'Keep' },
  { value: 'summarize', label: 'Summarize' },
  { value: 'drop', label: 'Drop' }
];

const SUMMARIZER_FALLBACK_VALUE = '__use_run_model__';

interface RulesHeaderProps {
  rules: ContextSummaryRules;
  /** Workspace this surface is bound to. The active workspace's id
   *  when `defaultScope === 'workspace'`; ignored when scope is
   *  `'global'`. Empty / null disables workspace-scoped saves. */
  workspaceId: string | null;
  /** Save scope. Inspector binds to `'workspace'`; Settings →
   *  Context binds to `'global'`. Each row auto-persists through
   *  this scope on change. */
  defaultScope: 'global' | 'workspace';
  /** When true, stacks label and control vertically for narrow panels. */
  compact?: boolean;
  /** Opens Settings → Context (inspector cross-link). */
  onOpenContextSettings?: () => void;
}

export function RulesHeader({
  rules,
  workspaceId,
  defaultScope,
  compact = false,
  onOpenContextSettings
}: RulesHeaderProps) {
  const updateRules = useContextSummaryStore((s) => s.updateRules);
  const showToast = useToastStore((s) => s.show);
  const providers = useProviderStore((s) => s.providers);
  // Optimistic local mirror so the UI snaps the moment the user
  // toggles a control; real settings refresh follows from the IPC.
  const [draft, setDraft] = useState<ContextSummaryRules>(rules);
  useEffect(() => setDraft(rules), [rules]);

  // Build the model dropdown items. Same shape the composer's model
  // picker uses; kept inline because the surface is small enough
  // that re-using the hook would add a dependency for one call site.
  const summarizerItems: DropdownItem<string>[] = useMemo(() => {
    const items: DropdownItem<string>[] = [
      {
        value: SUMMARIZER_FALLBACK_VALUE,
        label: "Use the run's current model",
        description: 'Falls back to the composer-selected model.'
      }
    ];
    for (const p of providers) {
      if (!p.enabled) continue;
      for (const m of p.models ?? []) {
        items.push({
          value: `${p.id}::${m.id}`,
          label: m.id,
          group: p.name
        });
      }
    }
    return items;
  }, [providers]);

  const currentSummarizerValue = draft.summarizerSelection
    ? `${draft.summarizerSelection.providerId}::${draft.summarizerSelection.modelId}`
    : SUMMARIZER_FALLBACK_VALUE;
  const resolvedSummarizerValue = summarizerItems.some(
    (i) => i.value === currentSummarizerValue
  )
    ? currentSummarizerValue
    : SUMMARIZER_FALLBACK_VALUE;

  /**
   * Auto-persist a single field. Mirrors the pattern Permissions
   * tab uses: the user toggles, the change goes straight to disk.
   * No batched "Save" button to lose changes to.
   */
  const persist = async (patch: Partial<ContextSummaryRules>) => {
    if (defaultScope === 'workspace' && (!workspaceId || workspaceId.length === 0)) {
      showToast('No workspace bound to this conversation.', 'danger');
      return;
    }
    try {
      await updateRules(
        defaultScope,
        patch,
        defaultScope === 'workspace' ? workspaceId ?? undefined : undefined
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast(`Save failed: ${msg}`, 'danger');
    }
  };

  const setField = <K extends keyof ContextSummaryRules>(
    key: K,
    value: ContextSummaryRules[K]
  ) => {
    if (draft[key] === value) return;
    setDraft({ ...draft, [key]: value });
    void persist({ [key]: value } as Partial<ContextSummaryRules>);
  };

  const setKindPolicy = (kind: MessageKind, next: ContextMessageKindPolicy) => {
    if (draft.perKindPolicy[kind] === next) return;
    const merged = { ...draft.perKindPolicy, [kind]: next };
    setDraft({ ...draft, perKindPolicy: merged });
    void persist({ perKindPolicy: merged });
  };

  const setSummarizer = (composed: string) => {
    if (composed === SUMMARIZER_FALLBACK_VALUE) {
      if (draft.summarizerSelection === null) return;
      setDraft({ ...draft, summarizerSelection: null });
      void persist({ summarizerSelection: null });
      return;
    }
    const idx = composed.indexOf('::');
    if (idx === -1) return;
    const providerId = composed.slice(0, idx);
    const modelId = composed.slice(idx + 2);
    const selection: ModelSelection = { providerId, modelId };
    setDraft({ ...draft, summarizerSelection: selection });
    void persist({ summarizerSelection: selection });
  };

  const onResetAll = async () => {
    setDraft(DEFAULT_CONTEXT_SUMMARY_RULES);
    await persist({
      enabled: DEFAULT_CONTEXT_SUMMARY_RULES.enabled,
      autoTriggerRatio: DEFAULT_CONTEXT_SUMMARY_RULES.autoTriggerRatio,
      keepRecentTurns: DEFAULT_CONTEXT_SUMMARY_RULES.keepRecentTurns,
      preserveUserPromptsAlways:
        DEFAULT_CONTEXT_SUMMARY_RULES.preserveUserPromptsAlways,
      preserveFirstSystem: DEFAULT_CONTEXT_SUMMARY_RULES.preserveFirstSystem,
      minMessagesToSummarize:
        DEFAULT_CONTEXT_SUMMARY_RULES.minMessagesToSummarize,
      maxRetries: DEFAULT_CONTEXT_SUMMARY_RULES.maxRetries,
      summarizerSelection: DEFAULT_CONTEXT_SUMMARY_RULES.summarizerSelection,
      perKindPolicy: { ...DEFAULT_CONTEXT_SUMMARY_RULES.perKindPolicy },
      droppedMarkerStyle: DEFAULT_CONTEXT_SUMMARY_RULES.droppedMarkerStyle
    });
  };

  return (
    <div className="flex flex-col">
      {onOpenContextSettings && (
        <div className="border-b border-border-subtle/30 py-2">
          <button
            type="button"
            onClick={onOpenContextSettings}
            className="text-row text-text-secondary transition-colors hover:text-text-primary"
          >
            Open global context settings…
          </button>
        </div>
      )}
      <ToggleRow
        label="Enable context summarization"
        description="Master kill switch. When off, neither the auto-trigger nor the manual button does anything."
        value={draft.enabled}
        onChange={(v) => setField('enabled', v)}
        compact={compact}
      />
      <RatioRow
        label="Auto-trigger ratio"
        description="Fire summarization when prompt-token usage crosses this fraction of the model's context window."
        value={draft.autoTriggerRatio}
        onChange={(v) => setField('autoTriggerRatio', v)}
        compact={compact}
      />
      <NumberRow
        label="Keep recent turns"
        description="Most-recent turns to leave verbatim at the tail. A turn is anchored by a user message."
        value={draft.keepRecentTurns}
        min={0}
        max={50}
        onChange={(v) => setField('keepRecentTurns', v)}
        compact={compact}
      />
      <NumberRow
        label="Min messages to summarize"
        description="Skip summarization when the eligible range has fewer than this many messages."
        value={draft.minMessagesToSummarize}
        min={1}
        max={50}
        onChange={(v) => setField('minMessagesToSummarize', v)}
        compact={compact}
      />
      <NumberRow
        label="Max retries"
        description="Provider call retries the summarizer is allowed before giving up."
        value={draft.maxRetries}
        min={0}
        max={5}
        onChange={(v) => setField('maxRetries', v)}
        compact={compact}
      />
      <ToggleRow
        label="Always preserve user prompts"
        description="Never summarize a role:'user' message even when the per-kind policy would. Recommended ON — silently rewriting user history is a confusing loss of trust."
        value={draft.preserveUserPromptsAlways}
        onChange={(v) => setField('preserveUserPromptsAlways', v)}
        compact={compact}
      />
      <ToggleRow
        label="Always preserve first system message"
        description="The orchestrator rebuilds the first system slot per iteration, so summarizing it would be a no-op anyway."
        value={draft.preserveFirstSystem}
        onChange={(v) => setField('preserveFirstSystem', v)}
        compact={compact}
      />
      <DroppedMarkerRow
        value={draft.droppedMarkerStyle}
        onChange={(v) => setField('droppedMarkerStyle', v)}
        compact={compact}
      />
      <SummarizerModelRow
        items={summarizerItems}
        value={resolvedSummarizerValue}
        onChange={setSummarizer}
        compact={compact}
      />
      <div className="flex flex-col gap-2 border-b border-border-subtle/30 py-3">
        <Eyebrow as="span" bold>
          Per-kind policy
        </Eyebrow>
        <div className="text-row leading-relaxed text-text-muted">
          Default decision for each message kind when no explicit
          per-message override is set.{' '}
          <code className="font-mono text-text-secondary">Auto</code> preserves
          small entries (under ~512 chars) and summarizes large ones.
        </div>
        <ul className="mt-1 flex flex-col">
          {KIND_ROWS.map((kind) => (
            <li
              key={kind}
              className={cn(
                'gap-3 py-1.5',
                compact ? 'flex flex-col items-start' : 'flex items-center justify-between'
              )}
            >
              <span className="text-row text-text-secondary">
                {labelForKind(kind)}
              </span>
              <div className="flex items-center gap-1">
                {POLICY_OPTIONS.map((opt) => (
                  <Button
                    key={opt.value}
                    size="sm"
                    variant={
                      draft.perKindPolicy[kind] === opt.value
                        ? 'primary'
                        : 'ghost'
                    }
                    onClick={() => setKindPolicy(kind, opt.value)}
                  >
                    {opt.label}
                  </Button>
                ))}
              </div>
            </li>
          ))}
        </ul>
      </div>
      <div className="flex items-center justify-end py-3">
        <Button size="sm" variant="ghost" onClick={() => void onResetAll()}>
          <RotateCcw className="h-3 w-3" strokeWidth={2.25} />
          Reset to defaults
        </Button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Row primitives. Each one mirrors the structure of `SettingsPanel`'s
// `Row` exactly — same wrapper, same body typography, same separator.
// ─────────────────────────────────────────────────────────────────────

function settingsRowClass(compact: boolean): string {
  return cn(
    'border-b border-border-subtle/30 py-3',
    compact ? 'flex flex-col gap-3' : 'flex items-start justify-between gap-4'
  );
}

function ToggleRow({
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
  return (
    <div className={settingsRowClass(compact)}>
      <div className="min-w-0 flex-1">
        <div className="text-body text-text-primary">{label}</div>
        <div className="mt-0.5 text-row leading-relaxed text-text-muted">
          {description}
        </div>
      </div>
      <Switch size="md" value={value} onChange={onChange} ariaLabel={label} />
    </div>
  );
}

function NumberRow({
  label,
  description,
  value,
  min,
  max,
  onChange,
  compact = false
}: {
  label: string;
  description: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
  compact?: boolean;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const commit = (raw: string) => {
    const next = Number.parseInt(raw, 10);
    if (!Number.isFinite(next)) {
      setDraft(String(value));
      return;
    }
    const clamped = Math.max(min, Math.min(max, next));
    setDraft(String(clamped));
    if (clamped !== value) onChange(clamped);
  };
  return (
    <div className={settingsRowClass(compact)}>
      <div className="min-w-0 flex-1">
        <div className="text-body text-text-primary">{label}</div>
        <div className="mt-0.5 text-row leading-relaxed text-text-muted">
          {description}
        </div>
      </div>
      <TextField
        type="number"
        value={draft}
        size="sm"
        tone="base"
        min={min}
        max={max}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => commit(draft)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit(draft);
          }
        }}
        className={cn('font-mono text-right', compact ? 'w-full' : 'w-16')}
      />
    </div>
  );
}

function RatioRow({
  label,
  description,
  value,
  onChange,
  compact = false
}: {
  label: string;
  description: string;
  value: number;
  onChange: (v: number) => void;
  compact?: boolean;
}) {
  const pct = Math.round(value * 100);
  return (
    <div className={settingsRowClass(compact)}>
      <div className="min-w-0 flex-1">
        <div className="text-body text-text-primary">{label}</div>
        <div className="mt-0.5 text-row leading-relaxed text-text-muted">
          {description}
        </div>
      </div>
      <div className={cn('flex shrink-0 items-center gap-2', compact && 'w-full')}>
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={pct}
          onChange={(e) => {
            const next = Number.parseInt(e.target.value, 10);
            if (!Number.isFinite(next)) return;
            onChange(Math.max(0, Math.min(1, next / 100)));
          }}
          className={cn('accent-accent', compact ? 'min-w-0 flex-1' : 'w-32')}
          aria-label={label}
        />
        <span className="w-10 text-right font-mono text-meta text-text-faint">
          {pct}%
        </span>
      </div>
    </div>
  );
}

function DroppedMarkerRow({
  value,
  onChange,
  compact = false
}: {
  value: DroppedMarkerStyle;
  onChange: (v: DroppedMarkerStyle) => void;
  compact?: boolean;
}) {
  return (
    <div className={settingsRowClass(compact)}>
      <div className="min-w-0 flex-1">
        <div className="text-body text-text-primary">Dropped-message marker</div>
        <div className="mt-0.5 text-row leading-relaxed text-text-muted">
          Choose how dropped messages appear inside the compressed body.
          Omit produces the cleanest summary; placeholders tell the agent
          something used to be there.
        </div>
      </div>
      <div className={cn('flex items-center gap-1', compact && 'flex-wrap')}>
        {(['omit', 'placeholder'] as DroppedMarkerStyle[]).map((opt) => (
          <Button
            key={opt}
            size="sm"
            variant={value === opt ? 'primary' : 'ghost'}
            onClick={() => onChange(opt)}
          >
            {opt === 'omit' ? 'Omit' : 'Placeholder'}
          </Button>
        ))}
      </div>
    </div>
  );
}

function SummarizerModelRow({
  items,
  value,
  onChange,
  compact = false
}: {
  items: DropdownItem<string>[];
  value: string;
  onChange: (composed: string) => void;
  compact?: boolean;
}) {
  return (
    <div className={settingsRowClass(compact)}>
      <div className="min-w-0 flex-1">
        <div className="text-body text-text-primary">Summarizer model</div>
        <div className="mt-0.5 text-row leading-relaxed text-text-muted">
          Pick a dedicated model for compression — typically a smaller / cheaper
          one than the orchestrator's. Defaults to the run's currently-selected
          model.
        </div>
      </div>
      <div className={cn(compact ? 'w-full' : 'shrink-0')}>
        <Dropdown<string>
          items={items}
          value={value}
          onChange={onChange}
          placeholder="Select model…"
          className={compact ? 'w-full' : undefined}
        />
      </div>
    </div>
  );
}
