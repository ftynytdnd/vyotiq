/**
 * Shared class names for timeline row chrome aligned with composer/dock.
 */

import { chromeLogWashClassName, chromeRowActionClassName } from '../../ui/SurfaceShell.js';
import { cn } from '../../../lib/cn.js';
import type { RunStatusPhase } from '@shared/types/chat.js';

/** Quiet uppercase label above user prompts and assistant prose. */
export const timelineEyebrowClassName =
  'mb-1 text-meta font-semibold uppercase tracking-[0.16em] text-text-secondary';

export const timelineContentMaxWidthClassName = 'w-full max-w-[46rem]';

/** Shared inset for activity row headers and response prose left edge. */
export const timelineAgentContentInsetClassName = 'pl-3.5';

/**
 * Left-aligned agent-side column — activity, response, and footer share
 * one max-width rail and a single left inset so eyebrows, rows, and prose
 * read on one vertical column.
 */
export const timelineAgentColumnClassName = cn(
  'timeline-agent-column',
  timelineContentMaxWidthClassName,
  timelineAgentContentInsetClassName,
  'flex w-full flex-col'
);

/** Reserve right gutter when the jump-to-latest chip is visible. */
export const timelineAgentColumnReserveRightClassName = 'pr-[5.5rem]';

/** Vertical rhythm inside a single turn block (legacy flat segment map). */
export const timelineTurnInnerGapClassName = 'gap-1.5';

/** Vertical rhythm between prompt / activity / response zones inside a turn. */
export const timelineTurnZoneGapClassName = 'gap-3';

/** Vertical rhythm between consecutive turn blocks in the transcript. */
export const timelineTurnOuterGapClassName = 'mb-10 pt-1 last:mb-0 last:pt-0';

/**
 * User prompt surface — flush in the reading column (no card, no ring).
 *
 * Vyotiq's earlier raised-card treatment paired a `bg-surface-raised/45`
 * fill with an inset hairline ring and right-aligned alignment. The May
 * 2026 timeline restyle drops the chrome entirely so user prompts read
 * as plain markdown flush in the agent column rail (matching the
 * Cursor-style chromeless reading column). The export is preserved as
 * an empty string so any out-of-tree caller still composes safely; the
 * row identity is now carried by `data-row-kind="user-prompt"` and
 * positional cues alone.
 */
export const timelinePromptCardClassName = '';

/** Live/completed activity lane — flat stack inside the agent column rail. */
export const timelineActivityLaneClassName = cn(
  'timeline-activity-lane',
  'flex flex-col gap-1.5'
);

/**
 * Agent response wrapper — flush prose with no surface chrome.
 *
 * The previous `bg-surface-overlay/[0.06]` lane + `rounded-inner py-2`
 * scaffolding was removed in the May 2026 restyle so assistant prose
 * flows directly in the column with the same rhythm as the activity
 * lane above it. The export remains a `flex flex-col gap-1.5` wrapper
 * so existing `:has()`-style child selectors in `TurnInlineStream`
 * (`[&_[data-row-kind=assistant-text]]:*`) still resolve to a real
 * element. Only the painted tokens were dropped.
 */
export const timelineResponseLaneClassName = cn('flex flex-col gap-1.5');

/**
 * Legacy spacer between activity block and response prose. The new
 * inline stream renders in wire order with a single `gap-1.5`, so the
 * dedicated separator is unused. Kept exported as an empty string for
 * source-compat with any callers in transit.
 */
export const timelineActivityResponseSeparatorClassName = '';

/** Tiny dot prefix used by the sub-agent header — running vs settled tones. */
export function timelineSubAgentDotClassName(running: boolean): string {
  return cn(
    'inline-block h-1.5 w-1.5 shrink-0 rounded-full',
    running ? 'bg-accent-gold-strong' : 'bg-text-muted'
  );
}

/** Italic muted subtitle beneath the sub-agent dot/title row. */
export const timelineSubAgentSubtitleClassName =
  'mt-0.5 line-clamp-1 pl-3 text-meta italic text-text-muted';

/** Compact provider/model chip floated to the right edge of a row. */
export const timelineModelBadgeClassName = cn(
  'inline-flex h-5 shrink-0 items-center gap-1 rounded-inner border border-border-subtle/25 px-1.5',
  'font-mono text-meta text-text-muted'
);

/** Category eyebrows inside the live activity lane (Reasoning, Tools, …). */
export const timelineCategoryEyebrowClassName =
  'mb-0.5 text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-text-muted';

/** Compact clickable row header (tool groups, reasoning, sub-agent collapsed). */
export const timelineRowHeaderClassName = cn(
  'app-no-drag flex w-full min-w-0 items-center gap-1.5 rounded-inner px-2 py-1 text-left',
  '[.timeline-activity-lane_&]:max-w-none',
  'text-meta text-text-muted',
  'transition-colors duration-150',
  'hover:bg-surface-hover/40'
);

/** Dock-style action pill — thin alias over chrome row/pill tokens. */
export const timelineActionPillClassName = chromeRowActionClassName;

const timelineRowIconClassName = 'h-3.5 w-3.5 shrink-0';

/** Chevron in row headers. */
export const timelineRowChevronClassName = cn(timelineRowIconClassName, 'text-chevron');

/**
 * Quiet log-line surface (agent thoughts, status lines, run closer).
 *
 * Inside the activity lane the row is intentionally chromeless to
 * match the Cursor-style flush stream. At the top level (e.g. the
 * trailing `RunCompleteRow` rendered outside any lane) the same
 * tokens still produce the legacy quiet-wash treatment.
 */
export const timelineLogRowClassName = cn(
  chromeLogWashClassName,
  timelineContentMaxWidthClassName,
  'px-2.5 py-1 text-meta text-text-faint',
  '[.timeline-activity-lane_&]:max-w-none [.timeline-activity-lane_&]:bg-transparent [.timeline-activity-lane_&]:px-0 [.timeline-activity-lane_&]:py-0.5'
);

/** Compact secondary activity line (status, reasoning, tool headers). */
export const timelineActivityRowClassName = cn(
  timelineLogRowClassName,
  'text-text-muted'
);

/** Live telemetry inside the activity lane — quiet, not a primary content block. */
export const timelineLiveStatusRowClassName = cn(
  'flex w-full min-w-0 items-center gap-1 py-1',
  'text-meta text-text-faint'
);

/** Live-turn shell — no extra chrome (left rail removed). */
export function timelineLiveTurnClassName(_live: boolean): string {
  return '';
}

/**
 * Assistant prose block — flush markdown in the column.
 *
 * Identity tokens only (`group` for hover affordances + the entrance
 * fade); the surrounding column inset comes from
 * {@link timelineAgentColumnClassName} via the parent
 * {@link TurnBlock}. No padding, no rounded corners, no fill.
 */
export const timelineAssistantRowClassName = cn(
  timelineResponseLaneClassName,
  'group vyotiq-stepfade-once'
);

/** Gold phase heading for live status + persisted Exploring dividers. */
export function timelinePhaseHeadingClassName(live = false): string {
  return cn(
    'font-semibold',
    live ? 'text-accent-gold-strong vyotiq-reveal-text' : 'text-accent-gold'
  );
}

/** Map run-status phase + label to the user-facing gold headline. */
export function resolveLivePhaseHeadline(
  phase: string,
  label: string
): string {
  if (phase === 'running-tool') return 'Exploring';
  return label;
}

/** Whether a persisted phase divider label is a live-phase headline. */
export function isPhaseHeadlineLabel(label: string): boolean {
  const normalized = label.trim().toLowerCase();
  return normalized === 'exploring' || normalized.startsWith('exploring ');
}

/** Gold headline phases — tool exploration and active token streams. */
export function isGoldLivePhase(phase: RunStatusPhase | 'streaming-reasoning' | 'streaming-text'): boolean {
  return (
    phase === 'running-tool' ||
    phase === 'streaming-reasoning' ||
    phase === 'streaming-text'
  );
}

/** In-flight tool row title — gold while pending, primary when settled. */
export function toolTitleClassName(running: boolean): string {
  return cn('font-medium', running ? 'text-accent-gold-strong' : 'text-text-primary');
}

/** Reasoning row headline — orchestrator vs sub-agent typography variants. */
export function reasoningHeadlineClassName(
  streaming: boolean,
  variant: 'orchestrator' | 'subagent' = 'orchestrator'
): string {
  if (variant === 'orchestrator') {
    return streaming
      ? cn(timelinePhaseHeadingClassName(true), 'truncate text-meta')
      : 'truncate text-meta text-text-faint';
  }
  return streaming
    ? cn(timelinePhaseHeadingClassName(true), 'min-w-0 flex-1 truncate text-row italic')
    : 'min-w-0 flex-1 truncate text-row italic text-text-muted';
}
