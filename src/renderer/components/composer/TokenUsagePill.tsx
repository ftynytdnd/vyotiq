/**
 * TokenUsagePill — compact chip that shows how full the model's
 * context window is right now. Sits alongside the model pill in the
 * composer.
 *
 * Three visual states:
 *
 *   1. **No ceiling pinned** — provider didn't expose `context_length`
 *      and the user hasn't set an override. Pill renders as a
 *      single-click action `Set ctx` so the user can pin a ceiling
 *      right here, without digging into the model picker. Once they
 *      hit Enter the pill flips into the active state on the next
 *      render.
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
 * No card UI. Stealth dark tokens only.
 */

import { useEffect, useRef, useState } from 'react';
import { BarChart2, Pencil } from 'lucide-react';
import { cn } from '../../lib/cn.js';
import { formatTokenCount, parseTokenCount } from '../../lib/formatTokens.js';

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
}

export function TokenUsagePill({
  used,
  ceiling,
  estimated,
  onCeilingChange
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
          'h-6 w-24 rounded-inner bg-surface-overlay px-1.5 font-mono text-meta',
          'text-text-primary outline-none focus:outline-none ring-1 ring-accent/60 placeholder:text-text-muted'
        )}
      />
    );
  }

  // ──────────────────────────────────────────────────────────────────
  // No ceiling pinned: render an actionable "Set ctx" button so the
  // user fixes the missing data right here, not in a settings menu.
  // ──────────────────────────────────────────────────────────────────
  if (!hasCeiling) {
    return (
      <button
        type="button"
        onClick={openEditor}
        aria-label="Set context window ceiling"
        title={
          `${used.toLocaleString()} tokens prepared` +
          `${estimated ? ' (pre-flight estimate)' : ''}. ` +
          `This provider didn't expose a context-window size. ` +
          `Click to set one (e.g. 128k, 1M).`
        }
        className={cn(
          'inline-flex h-6 shrink-0 items-center gap-1 rounded-inner bg-surface-overlay px-1.5 text-meta',
          'text-warning hover:bg-surface-hover',
          'transition-colors duration-150'
        )}
      >
        <BarChart2 className="h-3 w-3" strokeWidth={2} />
        <span className="font-mono">{formatTokenCount(used)} / </span>
        <span className="font-mono">
          set ctx
        </span>
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
  const barClass =
    ratio >= 0.9 ? 'bg-danger/70' : ratio >= 0.7 ? 'bg-warning/70' : 'bg-accent/60';

  const title =
    `${used.toLocaleString()} / ${ceiling!.toLocaleString()} tokens — ` +
    `${pct}% of context window used` +
    `${estimated ? ' (pre-flight estimate; the provider will replace it with the real count once the next turn streams)' : ''}. ` +
    `Click to retune.`;

  return (
    <button
      type="button"
      onClick={openEditor}
      aria-label="Retune context window ceiling"
      className={cn(
        'group relative inline-flex h-6 shrink-0 items-center gap-1 overflow-hidden rounded-inner bg-surface-overlay px-1.5 text-meta',
        'transition-colors duration-150 hover:bg-surface-hover',
        toneClass
      )}
      title={title}
    >
      <BarChart2 className="h-3 w-3" strokeWidth={2} />
      <span className="font-mono">
        {formatTokenCount(used)}
        <span
          className={cn('mx-0.5 text-text-faint', estimated ? 'italic' : '')}
          aria-hidden
        >
          /
        </span>
        {formatTokenCount(ceiling!)}
      </span>
      <span className="font-mono text-text-faint">{pctLabel}</span>
      <Pencil
        className="h-2.5 w-2.5 opacity-0 group-hover:opacity-70"
        strokeWidth={2}
      />
      <span
        aria-hidden
        className={cn('absolute bottom-0 left-0 h-[1px] transition-[width]', barClass)}
        style={{ width: barWidth }}
      />
    </button>
  );
}
