/**
 * TokenUsagePill — compact chip that shows how full the model's
 * context window is right now. Sits alongside the model pill in the
 * composer.
 *
 * Three visual states:
 *
 *   1. **No ceiling pinned** — provider didn't expose `context_length`
 *      and the user hasn't set an override. Pill renders as a CTA:
 *      `set ceiling` (Inspector wired) or `set ctx` (legacy editor
 *      wired) so the user can pin one without digging into the model
 *      picker. Once they hit Enter the pill flips into the active
 *      state on the next render. The two labels distinguish the
 *      surface where the click lands — `set ceiling` opens the
 *      Context Inspector panel (where the editor + summarize live);
 *      `set ctx` is the legacy inline-editor flow used by the
 *      Settings preview.
 *
 *   2. **Active (estimated)** — pre-flight BPE estimate, before the
 *      provider's real `usage` frame lands. Slash is italic to
 *      distinguish it from authoritative numbers.
 *
 *   3. **Active (actual)** — provider-reported `prompt + completion`
 *      tokens. Upright slash; tone shifts amber above 70 %, red above
 *      90 %. A 1-px progress bar spans the bottom of the pill. Pencil
 *      affordance on hover lets the user retune the ceiling inline.
 *
 * Phase 4 (2026): the hover tooltip surfaces the per-part breakdown
 *   - Prompt (with optional cached / cache-write detail)
 *   - Completion (with optional reasoning detail)
 *   - Pre-flight estimate (baseline + draft) when the run hasn't
 *     reported authoritative usage yet
 *
 * No card UI. Stealth dark tokens only.
 */

import { memo, useEffect, useRef, useState } from 'react';
import { BarChart2, Pencil } from 'lucide-react';
import type { TokenUsage } from '@shared/types/chat.js';
import { cn } from '../../lib/cn.js';
import {
  SHELL_MICRO_ICON_CLASS,
  SHELL_MICRO_ICON_STROKE,
  SHELL_ROW_ICON_CLASS,
  SHELL_ROW_ICON_STROKE
} from '../../lib/shellIcons.js';
import { dockChatMeterBarClassName } from '../dock/dockShared.js';
import { formatTokenCount, formatTokenCountWithUnit, parseTokenCount } from '../../lib/formatTokens.js';

export interface TokenUsagePillBaseline {
  total: number;
  systemPrompt: number;
  history: number;
  tools: number;
}

interface TokenUsagePillProps {
  used: number;
  ceiling?: number;
  /** True while we're showing a pre-flight BPE estimate. */
  estimated: boolean;
  /**
   * Persists a new context-window ceiling for the active model, or
   * clears the override when called with `null`. Wired by the composer
   * to `useProviderStore.setContextOverride(providerId, modelId, …)`.
   */
  onCeilingChange: (value: number | null) => void;
  /**
   * When provided, the pill's primary click opens the Context
   * Context Inspector panel instead of the inline ceiling editor.
   * The pencil affordance remains as a dedicated entry point for
   * the editor (visible on hover, click stops propagation so it
   * doesn't double-fire the inspector). When omitted (e.g. the
   * Settings preview surface) the pill keeps its legacy behaviour
   * — primary click opens the editor.
   */
  onOpenInspector?: () => void;
  /**
   * Phase 4 (2026): authoritative usage from the latest streamed
   * turn — used for the hover tooltip breakdown (cached / reasoning /
   * cache-write fields). Optional so the Settings preview surface
   * can omit it without rendering an empty tooltip.
   */
  usage?: TokenUsage;
  /**
   * Phase 4 (2026): pre-flight estimate breakdown for the prospective
   * payload (harness + envelopes + tools + replayed history). When
   * present alongside `draftTokens`, the tooltip surfaces the
   * `baseline + draft` split so the user understands where their
   * pre-Send token count is coming from.
   */
  baseline?: TokenUsagePillBaseline;
  /** Draft + attachments tokens (Phase 4). Same surface as `baseline`. */
  draftTokens?: number;
}

export const TokenUsagePill = memo(function TokenUsagePill({
  used,
  ceiling,
  estimated,
  onCeilingChange,
  onOpenInspector,
  usage,
  baseline,
  draftTokens
}: TokenUsagePillProps) {
  const hasCeiling = typeof ceiling === 'number' && ceiling > 0;

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  const openEditor = () => {
    setDraft(hasCeiling ? formatTokenCount(ceiling!) : '');
    setEditing(true);
  };

  const commit = () => {
    const trimmed = draft.trim();
    if (trimmed.length === 0) {
      onCeilingChange(null);
      setEditing(false);
      return;
    }
    const parsed = parseTokenCount(trimmed);
    if (parsed === null) {
      // Reject silently — the user can keep typing or cancel.
      setEditing(false);
      return;
    }
    onCeilingChange(parsed);
    setEditing(false);
  };

  // ──────────────────────────────────────────────────────────────────
  // Inline editor: shared between the "no ceiling" and "retune" flows.
  // ──────────────────────────────────────────────────────────────────
  if (editing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onClick={(e) => e.stopPropagation()}
        onBlur={commit}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') {
            e.preventDefault();
            commit();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            setEditing(false);
          }
        }}
        placeholder="e.g. 128k, 1M"
        aria-label="Context window ceiling"
        title="Set this model's context-window ceiling. Accepts 128k, 1.5M, or raw integers. Empty clears the override."
        className={cn(
          'vx-input w-24 px-0 py-0.5 font-mono text-chat-meta text-text-primary',
          'ring-1 ring-edge-light-focus placeholder:text-text-muted'
        )}
      />
    );
  }

  // ──────────────────────────────────────────────────────────────────
  // No ceiling pinned: surface the Inspector as the primary action
  // when one is wired. Without it, the pill would dead-end into the
  // tiny inline editor and the user could never reach the Context
  // Inspector or the manual summarize button — which is exactly the
  // class of providers (Ollama / LM Studio / vLLM without
  // `context_length` on `/v1/models`) where compression matters
  // most. The pencil affordance keeps the ceiling-edit path one
  // click away. When `onOpenInspector` isn't wired (e.g. the
  // Settings preview surface), we fall back to the legacy
  // edit-on-click behavior so existing entry points keep working.
  // ──────────────────────────────────────────────────────────────────
  if (!hasCeiling) {
    const primaryAction = onOpenInspector ?? openEditor;
    const primaryLabel = onOpenInspector
      ? 'Open Context Inspector'
      : 'Set context window ceiling';
    const primaryTitle =
      `${used.toLocaleString()} tokens prepared` +
      `${estimated ? ' (pre-flight estimate)' : ''}. ` +
      `This provider didn't expose a context-window size, so the ` +
      `auto-trigger is disabled until you pin one. ` +
      (onOpenInspector
        ? 'Click to open the Context Inspector (manual summarize, per-message overrides, set ceiling).'
        : 'Click to set a ceiling (e.g. 128k, 1M).');
    const pillClass = cn(
      'vx-composer-token-pill',
      'group relative shrink-0 text-warning transition-colors duration-150'
    );
    if (onOpenInspector) {
      return (
        <div className={pillClass}>
          <button
            type="button"
            onClick={primaryAction}
            aria-label={primaryLabel}
            title={primaryTitle}
            className="vx-composer-token-pill__label hover:bg-transparent"
          >
            <BarChart2 className={SHELL_ROW_ICON_CLASS} strokeWidth={SHELL_ROW_ICON_STROKE} aria-hidden />
            <span className="font-mono">{formatTokenCount(used)}</span>
            <span className="text-text-faint" aria-hidden>·</span>
            <span className="font-medium text-warning-strong underline decoration-warning/40 underline-offset-2">
              set ceiling
            </span>
          </button>
          <button
            type="button"
            onClick={openEditor}
            aria-label="Set context window ceiling"
            title="Set ceiling (e.g. 128k, 1M)"
            className="ml-0.5 inline-flex items-center opacity-0 transition-opacity group-hover:opacity-70 hover:opacity-100 focus-visible:opacity-100"
          >
            <Pencil className={SHELL_MICRO_ICON_CLASS} strokeWidth={SHELL_MICRO_ICON_STROKE} />
          </button>
        </div>
      );
    }
    return (
      <button
        type="button"
        onClick={primaryAction}
        aria-label={primaryLabel}
        title={primaryTitle}
        className={pillClass}
      >
        <BarChart2 className={SHELL_ROW_ICON_CLASS} strokeWidth={SHELL_ROW_ICON_STROKE} aria-hidden />
        <span className="font-mono">{formatTokenCount(used)}</span>
        <span className="text-text-faint" aria-hidden>·</span>
        <span className="font-medium text-warning-strong underline decoration-warning/40 underline-offset-2">
          set ctx
        </span>
        <Pencil
          className={cn(SHELL_MICRO_ICON_CLASS, 'opacity-0 group-hover:opacity-70')}
          strokeWidth={SHELL_MICRO_ICON_STROKE}
          aria-hidden
        />
      </button>
    );
  }

  // ──────────────────────────────────────────────────────────────────
  // Active state with a real ceiling.
  // ──────────────────────────────────────────────────────────────────
  const ratio = Math.min(1, used / ceiling!);
  const pct = Math.round(ratio * 100);
  // Tiny percentages still get a "<1%" label so the user sees activity.
  const pctLabel = ratio > 0 && pct === 0 ? '<1%' : `${pct}%`;
  // Bar width clamped at 100 % visually; over-budget still colored red.
  const barWidth = `${Math.min(100, pct)}%`;

  const toneClass =
    ratio >= 0.9 ? 'text-danger' : ratio >= 0.7 ? 'text-warning' : 'text-text-secondary';
  const barClass = dockChatMeterBarClassName(ratio);

  const title = buildBreakdownTitle({
    used,
    ceiling: ceiling!,
    pct,
    estimated,
    usage,
    baseline,
    draftTokens
  });

  // Primary click: open the Inspector when wired, otherwise fall
  // back to the inline ceiling editor (legacy behaviour for any
  // surface that hasn't wired the inspector panel yet).
  const primaryAction = onOpenInspector ?? openEditor;
  const primaryLabel = onOpenInspector
    ? 'Open Context Inspector'
    : 'Retune context window ceiling';
  const primaryTitle = onOpenInspector
    ? `${title} Click to open the Context Inspector.`
    : `${title}`;

  const activePillClass = cn(
    'vx-composer-token-pill group relative min-w-0 shrink-0',
    'transition-colors duration-150',
    toneClass
  );
  const activeLabel = (
    <span className="vx-composer-token-pill__label">
      <BarChart2 className={cn(SHELL_ROW_ICON_CLASS, 'shrink-0')} strokeWidth={SHELL_ROW_ICON_STROKE} aria-hidden />
      <span className="truncate">
        {formatTokenCount(used)}
        <span
          className={cn('mx-0.5 text-text-faint', estimated ? 'italic' : '')}
          aria-hidden
        >
          /
        </span>
        {formatTokenCount(ceiling!)}
      </span>
      <span className="vx-composer-token-pill__pct shrink-0">{pctLabel}</span>
    </span>
  );
  const progressBar = (
    <span aria-hidden className="vx-composer-token-pill__track">
      <span
        className={cn('vx-composer-token-pill__bar', barClass)}
        style={{ width: barWidth }}
      />
    </span>
  );

  if (onOpenInspector) {
    return (
      <div className={activePillClass} title={primaryTitle}>
        <button
          type="button"
          onClick={primaryAction}
          aria-label={primaryLabel}
          className="inline-flex min-w-0 flex-1 items-center gap-1.5 hover:bg-transparent"
        >
          {activeLabel}
          {progressBar}
        </button>
        <button
          type="button"
          onClick={openEditor}
          aria-label="Edit context window ceiling"
          title="Edit ceiling"
          className="inline-flex shrink-0 items-center opacity-0 transition-opacity group-hover:opacity-70 hover:opacity-100 focus-visible:opacity-100"
        >
          <Pencil className={SHELL_MICRO_ICON_CLASS} strokeWidth={SHELL_MICRO_ICON_STROKE} />
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={primaryAction}
      aria-label={primaryLabel}
      className={activePillClass}
      title={primaryTitle}
    >
      <span className="inline-flex min-w-0 items-center gap-1.5">
        {activeLabel}
        {progressBar}
        <Pencil
          className={cn(SHELL_MICRO_ICON_CLASS, 'opacity-0 group-hover:opacity-70')}
          strokeWidth={SHELL_MICRO_ICON_STROKE}
          aria-hidden
        />
      </span>
    </button>
  );
});

/**
 * Phase 4 (2026): builds the hover-tooltip body for the active-state
 * pill. Surfaces:
 *
 *   - The headline `used / ceiling pct%` line every pill has shown
 *     since v1.
 *   - Prompt + completion split when authoritative `usage` has
 *     landed.
 *   - Cached / cache-write / reasoning sub-lines when the provider
 *     reported them (2026 providers — see the plan's reference
 *     matrix).
 *   - The pre-flight `baseline + draft` split when no authoritative
 *     usage has landed yet (helps the user understand why their
 *     "before sending" count is what it is).
 *
 * Output is a single `\n`-joined string so it can land directly in
 * the `title=` attribute (which is what the existing pill uses).
 * The HTML `title` attribute supports literal newlines on every
 * major browser as of 2026.
 *
 * Pure / synchronous — no IO, no React state.
 */
function buildBreakdownTitle(args: {
  used: number;
  ceiling: number;
  pct: number;
  estimated: boolean;
  usage?: TokenUsage;
  baseline?: TokenUsagePillBaseline;
  draftTokens?: number;
}): string {
  const { used, ceiling, pct, estimated, usage, baseline, draftTokens } = args;
  const lines: string[] = [];
  const hasRunUsage = usage && (usage.promptTokens > 0 || usage.completionTokens > 0);
  lines.push(
    `Context: ${formatTokenCount(used)} / ${formatTokenCount(ceiling)} · ${pct}% of context window used`
  );
  if (estimated) {
    lines.push('(pre-flight estimate — the provider will replace it with the real count once the next turn streams)');
  }
  if (hasRunUsage) {
    lines.push('');
    lines.push('Run total (latest turn):');
    if (usage!.promptTokens > 0) {
      lines.push(`Prompt: ${formatTokenCountWithUnit(usage!.promptTokens)}`);
      if (typeof usage!.cachedPromptTokens === 'number' && usage!.cachedPromptTokens > 0) {
        lines.push(`  · cached: ${formatTokenCountWithUnit(usage!.cachedPromptTokens)}`);
      }
      if (typeof usage!.cacheCreationTokens === 'number' && usage!.cacheCreationTokens > 0) {
        lines.push(`  · cache write: ${formatTokenCountWithUnit(usage!.cacheCreationTokens)}`);
      }
    }
    if (usage!.completionTokens > 0) {
      lines.push(`Completion: ${formatTokenCountWithUnit(usage!.completionTokens)}`);
      if (typeof usage!.reasoningTokens === 'number' && usage!.reasoningTokens > 0) {
        lines.push(`  · reasoning: ${formatTokenCountWithUnit(usage!.reasoningTokens)}`);
      }
    }
  } else if (baseline && typeof draftTokens === 'number') {
    // Pre-flight only — no real usage yet. Show the baseline + draft
    // split so the user understands the headline number.
    lines.push('');
    lines.push(`Context (pre-flight): ${formatTokenCountWithUnit(baseline.total)} baseline + ${formatTokenCountWithUnit(draftTokens)} draft`);
    lines.push(`  · system prompt: ${formatTokenCountWithUnit(baseline.systemPrompt)}`);
    lines.push(`  · tools: ${formatTokenCountWithUnit(baseline.tools)}`);
    lines.push(`  · history: ${formatTokenCountWithUnit(baseline.history)}`);
  }
  lines.push('');
  lines.push('Click to retune.');
  return lines.join('\n');
}
