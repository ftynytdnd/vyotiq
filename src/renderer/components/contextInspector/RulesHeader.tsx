/**
 * Flat rules form for the Context Inspector / Settings → Context tab.
 *
 * Visual contract: Vyotiq UI row pattern (`ShellRow`, `ShellRowSplit`,
 * `vx-segment`) matching Settings → Permissions and the mockup kit.
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
import { Switch } from '../ui/Switch.js';
import { TextField } from '../ui/TextField.js';
import { RangeField } from '../ui/RangeField.js';
import { Tabs, type TabItem } from '../ui/Tabs.js';
import {
  ShellActionRow,
  ShellCaption,
  ShellRow,
  ShellRowSplit,
  ShellSection,
  ShellStack
} from '../ui/ShellSection.js';
import { chromeGhostRowButtonClassName } from '../ui/SurfaceShell.js';
import { useContextSummaryStore } from '../../store/useContextSummaryStore.js';
import { useProviderStore } from '../../store/useProviderStore.js';
import { useToastStore } from '../../store/useToastStore.js';
import { cn } from '../../lib/cn.js';
import { SHELL_ACTION_ICON_STROKE, SHELL_ROW_ICON_CLASS } from '../../lib/shellIcons.js';
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
  workspaceId: string | null;
  defaultScope: 'global' | 'workspace';
  compact?: boolean;
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
  const [draft, setDraft] = useState<ContextSummaryRules>(rules);
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    setDirty(false);
  }, [workspaceId, defaultScope]);
  useEffect(() => {
    if (!dirty) setDraft(rules);
  }, [rules, dirty]);

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
    setDirty(true);
    setDraft({ ...draft, [key]: value });
    void persist({ [key]: value } as Partial<ContextSummaryRules>);
  };

  const setKindPolicy = (kind: MessageKind, next: ContextMessageKindPolicy) => {
    if (draft.perKindPolicy[kind] === next) return;
    setDirty(true);
    const merged = { ...draft.perKindPolicy, [kind]: next };
    setDraft({ ...draft, perKindPolicy: merged });
    void persist({ perKindPolicy: merged });
  };

  const setSummarizer = (composed: string) => {
    setDirty(true);
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
    setDirty(false);
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
    <ShellStack>
      {onOpenContextSettings && (
        <ShellRow>
          <button
            type="button"
            onClick={onOpenContextSettings}
            className={chromeGhostRowButtonClassName}
          >
            Open global context settings…
          </button>
        </ShellRow>
      )}
      <ToggleRow
        label="Enable context summarization"
        description="Master kill switch. When off, neither the auto-trigger nor the manual button does anything."
        value={draft.enabled}
        onChange={(v) => setField('enabled', v)}
      />
      <RatioRow
        label="Auto-trigger ratio"
        description="Fire summarization when prompt-token usage crosses this fraction of the model's context window."
        value={draft.autoTriggerRatio}
        onChange={(v) => setField('autoTriggerRatio', v)}
      />
      <NumberRow
        label="Keep recent turns"
        description="Most-recent turns to leave verbatim at the tail. A turn is anchored by a user message."
        value={draft.keepRecentTurns}
        min={0}
        max={50}
        onChange={(v) => setField('keepRecentTurns', v)}
      />
      <NumberRow
        label="Min messages to summarize"
        description="Skip summarization when the eligible range has fewer than this many messages."
        value={draft.minMessagesToSummarize}
        min={1}
        max={50}
        onChange={(v) => setField('minMessagesToSummarize', v)}
      />
      <NumberRow
        label="Max retries"
        description="Provider call retries the summarizer is allowed before giving up."
        value={draft.maxRetries}
        min={0}
        max={5}
        onChange={(v) => setField('maxRetries', v)}
      />
      <ToggleRow
        label="Always preserve user prompts"
        description="Never summarize a role:'user' message even when the per-kind policy would. Recommended ON — silently rewriting user history is a confusing loss of trust."
        value={draft.preserveUserPromptsAlways}
        onChange={(v) => setField('preserveUserPromptsAlways', v)}
      />
      <ToggleRow
        label="Always preserve first system message"
        description="The orchestrator rebuilds the first system slot per iteration, so summarizing it would be a no-op anyway."
        value={draft.preserveFirstSystem}
        onChange={(v) => setField('preserveFirstSystem', v)}
      />
      <DroppedMarkerRow
        value={draft.droppedMarkerStyle}
        onChange={(v) => setField('droppedMarkerStyle', v)}
      />
      <SummarizerModelRow
        items={summarizerItems}
        value={resolvedSummarizerValue}
        onChange={setSummarizer}
      />
      <ShellSection title="Per-kind policy">
        <ShellCaption className="mb-3">
          Default decision for each message kind when no explicit per-message override is set.{' '}
          <code className="font-mono text-text-secondary">Auto</code> preserves small entries
          (under ~512 chars) and summarizes large ones.
        </ShellCaption>
        <ul className="flex flex-col">
          {KIND_ROWS.map((kind) => (
            <li key={kind}>
              <ShellRow>
                <ShellRowSplit
                  main={<span className="vx-row-label text-row">{labelForKind(kind)}</span>}
                  control={
                    <Tabs<ContextMessageKindPolicy>
                      variant="segmented"
                      size="sm"
                      ariaLabel={`Policy for ${kind}`}
                      className={compact ? 'w-full' : 'shrink-0'}
                      items={POLICY_OPTIONS.map((opt) => ({
                        id: opt.value,
                        label: opt.label
                      }))}
                      value={draft.perKindPolicy[kind]}
                      onChange={(next) => setKindPolicy(kind, next)}
                    />
                  }
                />
              </ShellRow>
            </li>
          ))}
        </ul>
      </ShellSection>
      <ShellRow>
        <ShellActionRow className="justify-end pt-0">
          <Button size="sm" variant="ghost" onClick={() => void onResetAll()}>
            <RotateCcw className={SHELL_ROW_ICON_CLASS} strokeWidth={SHELL_ACTION_ICON_STROKE} />
            Reset to defaults
          </Button>
        </ShellActionRow>
      </ShellRow>
    </ShellStack>
  );
}

function ToggleRow({
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
    <ShellRow>
      <ShellRowSplit
        main={
          <>
            <div className="vx-row-label">{label}</div>
            <p className="vx-row-desc">{description}</p>
          </>
        }
        control={
          <TextField
            type="number"
            appearance="boxed"
            size="sm"
            value={draft}
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
        }
      />
    </ShellRow>
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
    <ShellRow>
      <ShellRowSplit
        main={
          <>
            <div className="vx-row-label">{label}</div>
            <p className="vx-row-desc">{description}</p>
          </>
        }
        control={
          <div className={cn('flex shrink-0 items-center gap-2', compact && 'w-full')}>
            <RangeField
              min={0}
              max={100}
              step={1}
              value={pct}
              valueRatio={value}
              onChange={(e) => {
                const next = Number.parseInt(e.target.value, 10);
                if (!Number.isFinite(next)) return;
                onChange(Math.max(0, Math.min(1, next / 100)));
              }}
              className={compact ? 'min-w-0 flex-1' : undefined}
              aria-label={label}
            />
            <span className="w-10 text-right font-mono text-meta text-text-secondary">
              {pct}%
            </span>
          </div>
        }
      />
    </ShellRow>
  );
}

const DROPPED_MARKER_TABS: TabItem<DroppedMarkerStyle>[] = [
  { id: 'omit', label: 'Omit' },
  { id: 'placeholder', label: 'Placeholder' }
];

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
    <ShellRow>
      <ShellRowSplit
        main={
          <>
            <div className="vx-row-label">Dropped-message marker</div>
            <p className="vx-row-desc">
              Choose how dropped messages appear inside the compressed body. Omit produces the
              cleanest summary; placeholders tell the agent something used to be there.
            </p>
          </>
        }
        control={
          <Tabs<DroppedMarkerStyle>
            variant="segmented"
            size="sm"
            ariaLabel="Dropped message marker style"
            className={compact ? 'w-full' : undefined}
            items={DROPPED_MARKER_TABS}
            value={value}
            onChange={onChange}
          />
        }
      />
    </ShellRow>
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
    <ShellRow>
      <ShellRowSplit
        main={
          <>
            <div className="vx-row-label">Summarizer model</div>
            <p className="vx-row-desc">
              Pick a dedicated model for compression — typically a smaller / cheaper one than the
              orchestrator&apos;s. Defaults to the run&apos;s currently-selected model.
            </p>
          </>
        }
        control={
          <Dropdown<string>
            items={items}
            value={value}
            onChange={onChange}
            placeholder="Select model…"
            className={compact ? 'w-full' : 'min-w-[12rem]'}
          />
        }
      />
    </ShellRow>
  );
}
