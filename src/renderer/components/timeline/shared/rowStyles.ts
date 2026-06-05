/**
 * Shared class names for timeline row chrome aligned with Vyotiq UI.
 */

import { cn } from '../../../lib/cn.js';
import { SHELL_ROW_ICON_CLASS, SHELL_ACTION_ICON_STROKE } from '../../../lib/shellIcons.js';
import type { RunStatusPhase } from '@shared/types/chat.js';

/** Shared inset for activity row headers and response prose left edge. */
const timelineAgentContentInsetClassName = '';

/**
 * Left-aligned agent-side column — activity, response, and footer share
 * one max-width rail and a single left inset so eyebrows, rows, and prose
 * read on one vertical column.
 */
export const timelineAgentColumnClassName = cn(
  'timeline-agent-column vx-timeline-agent-column',
  timelineAgentContentInsetClassName,
  'flex w-full flex-col'
);

/** Vertical rhythm between prompt / activity / response zones inside a turn. */
export const timelineTurnZoneGapClassName = 'vx-timeline-turn-gap';

/** Vertical rhythm between consecutive turn blocks in the transcript. */
export const timelineTurnOuterGapClassName = 'vx-timeline-turn-outer last:mb-0 last:pt-0';

/**
 * User prompt surface — flush in the reading column (no card, no ring).
 *
 * Vyotiq's earlier raised-card treatment paired a `bg-surface-raised/45`
 * fill with an inset hairline ring and right-aligned alignment. The May
 * 2026 timeline restyle drops the chrome entirely so user prompts read
 * as plain markdown flush in the agent column rail. The export is preserved as
 * an empty string so any out-of-tree caller still composes safely; the
 * row identity is now carried by `data-row-kind="user-prompt"` and
 * positional cues alone.
 */
/**
 * Agent response wrapper — flush prose with no surface chrome.
 *
 * The previous `bg-surface-overlay/[0.06]` lane + `rounded-inner py-2`
 * scaffolding was removed in the May 2026 restyle so assistant prose
 * flows directly in the column with the same rhythm as the activity
 * lane above it. The export remains a `flex flex-col gap-1.5` wrapper
 * so existing `:has()`-style child selectors on the response lane
 * (`[&_[data-row-kind=assistant-text]]:*`) still resolve to a real
 * element. Only the painted tokens were dropped.
 */
const timelineResponseLaneClassName = cn('vx-timeline-response-lane', 'flex flex-col');

/** Compact clickable row header (tool groups, reasoning, collapsed rows). */
export const timelineRowHeaderClassName = 'app-no-drag vx-timeline-row-header';

/** Vyotiq UI quiet action pill for timeline row affordances. */
export const timelineActionPillClassName = cn('app-no-drag vx-timeline-action');

const timelineRowIconClassName = SHELL_ROW_ICON_CLASS;

/** Chevron in row headers. */
export const timelineRowChevronClassName = cn(timelineRowIconClassName, 'text-chevron opacity-70');
export const timelineRowChevronStroke = SHELL_ACTION_ICON_STROKE;

/**
 * Quiet log-line surface (agent thoughts, status lines, run closer).
 *
 * Inside the activity lane the row is intentionally chromeless to
 * match the flush activity stream. At the top level (e.g. the
 * trailing `RunCompleteRow` rendered outside any lane) the same
 * tokens still produce the legacy quiet-wash treatment.
 */
export const timelineLogRowClassName = cn('vx-timeline-log-row', 'flex w-full flex-col');

/** Run-complete footer — inline metadata on one baseline row. */
export const timelineRunCompleteRowClassName = cn(
  'vx-timeline-log-row',
  'flex w-full flex-row flex-wrap items-baseline gap-x-1.5'
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

/** User prompt body — open Vyotiq UI typography. */
export const timelineUserPromptBodyClassName = 'vx-timeline-prompt';

/** Gold phase heading for live status + persisted Exploring dividers. */
export function timelinePhaseHeadingClassName(live = false): string {
  return live ? 'vx-timeline-phase-live vyotiq-reveal-text' : 'vx-timeline-phase';
}

/** Map run-status phase + label to the user-facing gold headline. */
export function resolveLivePhaseHeadline(
  phase: string,
  label: string
): string {
  if (phase === 'running-tool') return 'Exploring';
  if (phase === 'awaiting-response') return 'Starting…';
  return label;
}

/** Phases where the live status headline should not appear (content is streaming). */
export function shouldHideLivePhaseHeadline(phase: string): boolean {
  return phase === 'streaming-text' || phase === 'streaming-reasoning';
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

/** In-flight tool row title — primary while pending, settled label when done. */
export function toolTitleClassName(running: boolean, failed = false): string {
  return cn(
    'font-medium',
    running
      ? 'text-text-primary'
      : failed
        ? 'text-danger'
        : 'vx-row-label text-[length:var(--text-row)] text-text-secondary'
  );
}

/** Reasoning row headline typography. */
export function reasoningHeadlineClassName(streaming: boolean): string {
  return streaming
    ? cn(timelinePhaseHeadingClassName(true), 'truncate text-meta')
    : 'truncate text-meta vx-caption';
}

/** Timeline stack wrapper (Timeline.tsx root). */
export const timelineStackClassName = 'vx-timeline-stack';


