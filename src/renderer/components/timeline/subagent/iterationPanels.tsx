/**
 * Per-iteration reasoning + text panels for a sub-agent's body.
 *
 * Extracted from the previous monolithic `SubAgentBody.tsx` so the new
 * `SubAgentRunFlow` (which interleaves panels with tool-call rows in
 * true execution order — see file header in
 * `SubAgentRunFlow.tsx`) can reuse them without duplicating the
 * scroll-tracking + envelope-strip logic.
 *
 * Behaviour parity with the orchestrator-level rows (audit fix C4 / C5):
 *   - `ReasoningPanel` uses `TimelineRowHeader` + `useTimelineRowExpand`
 *     (persisted expand, live auto-expand while streaming) mirroring
 *     `ReasoningLineRow`.
 *   - `TextPanel` caps its body at `MAX_TEXT_BODY_H` with internal
 *     scroll + tail-stick so a 300-line worker report can't devour
 *     the viewport.
 *   - Neither panel applies shimmer to the body. Gold phase headings
 *     on the row header carry the live signal instead.
 */

import { useMemo } from 'react';
import { Brain } from 'lucide-react';
import { StreamingMarkdownBody } from '../markdown/StreamingMarkdownBody.js';
import { cn } from '../../../lib/cn.js';
import { formatReasoningLabel } from '../../../lib/reasoningLabel.js';
import { DetailShell } from '../shared/DetailShell.js';
import { TimelineRowHeader } from '../shared/TimelineRowHeader.js';
import { useTimelineRowExpand } from '../shared/useTimelineRowExpand.js';
import {
  reasoningHeadlineClassName
} from '../shared/rowStyles.js';
import { useScrollTailStick } from '../shared/useScrollTailStick.js';
import { stripDelegatesForDisplay } from '../../../lib/text.js';

/** Cap on rendered reasoning body height — same rhythm as
 *  `ReasoningLineRow` so the orchestrator and worker surfaces feel
 *  consistent. */
const REASONING_BODY_MAX_H = 'max-h-48';

/**
 * Cap on the rendered assistant-text body. Audit fix C5: long
 * structured worker outputs (300+ line code-quality reports) were
 * stretching the sub-agent card to fill the viewport, dominating the
 * timeline scroll. ~28rem ≈ 28-30 lines of leading-relaxed prose
 * keeps the card present without being abusive; the body becomes
 * internally scrollable past this height with tail-tracking
 * (`stickRef`).
 */
const TEXT_BODY_MAX_H = 'max-h-[28rem]';

interface ReasoningPanelProps {
  subagentId: string;
  iterationId: string;
  text: string;
  done: boolean;
  startedAt: number;
  endedAt?: number;
}

export function ReasoningPanel({
  subagentId,
  iterationId,
  text,
  done,
  startedAt,
  endedAt
}: ReasoningPanelProps) {
  const rowKey = `sub-reasoning:${subagentId}:${iterationId}`;
  const { expanded, onToggle } = useTimelineRowExpand({
    rowKey,
    defaultExpanded: false,
    liveAutoExpand: !done
  });

  const { bodyRef, onBodyScroll } = useScrollTailStick(text, {
    active: !done,
    expanded
  });

  // Stopwatch label — shared with `ReasoningLineRow` via
  // `formatReasoningLabel` so the orchestrator and sub-agent reasoning
  // surfaces always read identically (live `Thinking…`, settled
  // `Thought for Ns`).
  const { text: label, streaming } = formatReasoningLabel({
    startedAt,
    ...(endedAt !== undefined ? { endedAt } : {}),
    done
  });

  const onToggleHeader = onToggle;

  return (
    <div className="vyotiq-stepfade-once flex flex-col">
      <TimelineRowHeader expanded={expanded} onToggle={onToggleHeader}>
        <span className="inline-flex min-w-0 items-center gap-1.5">
          <Brain className="h-3.5 w-3.5 shrink-0 text-accent" strokeWidth={2} />
          <span className={reasoningHeadlineClassName(streaming, 'subagent')}>{label}</span>
        </span>
      </TimelineRowHeader>
      {expanded && (
        <DetailShell variant="flat">
          <div
            ref={bodyRef}
            onScroll={onBodyScroll}
            className={cn(
              'overflow-y-auto whitespace-pre-wrap pr-1 text-row italic leading-relaxed text-text-muted',
              REASONING_BODY_MAX_H
            )}
          >
            {text}
          </div>
        </DetailShell>
      )}
    </div>
  );
}

/**
 * Strip the worker's `<result>…</result>` envelope from the streaming
 * body BEFORE it reaches the markdown renderer.
 *
 * Two failure modes the previous implementation produced (see
 * historical screenshots in repo notes):
 *   1. While the close tag was still in flight, the entire opening
 *      `<result> <status>success</status> <summary>…` envelope
 *      rendered as raw angle-bracket text inside the worker body
 *      (`react-markdown` does not parse unknown XML, it escapes it).
 *   2. Once the close tag arrived but BEFORE the `subagent-result`
 *      event landed in the store, the same envelope was visible in
 *      both the worker body AND about to be replaced by the
 *      structured `SubAgentResult` — a brief but jarring duplication.
 *
 * The current policy: any `<result …>` opener (with or without a
 * matching close tag) marks the boundary between "narrative" and
 * "envelope". Drop everything from the opener onward. The structured
 * `SubAgentResult` renders the parsed body once the worker settles,
 * and the panel above stays focused on the worker's prose narrative
 * the whole way through.
 *
 * Why NOT use the shared `stripDelegatesForDisplay` here:
 *   `stripDelegatesForDisplay` removes only the matched envelope and
 *   preserves any prose AFTER it. That's correct for the orchestrator
 *   path (a model is allowed to keep talking after a `<delegate />`),
 *   but for sub-agents the contract is stricter — anything emitted
 *   after `<result>` is misformatted output that should be HIDDEN, not
 *   surfaced as trailing prose. So this helper is intentionally
 *   narrower than the shared strip: truncate-tail vs envelope-removal.
 *   Future contributors: do not "deduplicate" by switching to the
 *   shared helper without first widening the sub-agent harness
 *   contract.
 *
 * Pure / no-throw — safe inside a React render path.
 */
const RESULT_OPEN_RE = /<result\b[^>]*>/i;

function stripResultEnvelope(text: string): string {
  const m = RESULT_OPEN_RE.exec(text);
  if (!m) return text;
  return text.slice(0, m.index).trimEnd();
}

interface TextPanelProps {
  subagentId: string;
  iterationId: string;
  text: string;
  done: boolean;
}

export function TextPanel({ subagentId: _subagentId, iterationId: _iterationId, text, done }: TextPanelProps) {
  // Two-stage strip — memoized on `text` because `stripDelegatesForDisplay`
  // is a regex-heavy scan over the entire accumulated body and gets
  // hammered on every RAF-batched delta during a long worker stream
  // (audit fix H4 — the unmemoized version was one of the dominant
  // streaming-jank sources).
  //
  // Two-stage rationale:
  //   1. `stripResultEnvelope` enforces the sub-agent contract — any
  //      `<result …>` opener marks the end of narrative; everything
  //      from that point onward is hidden (the structured
  //      `SubAgentResult` becomes the sole surface for the close
  //      payload).
  //   2. `stripDelegatesForDisplay` is layered on the surviving prefix
  //      as defense-in-depth: a misbehaving sub-agent that emitted any
  //      orchestration-shaped tag in its prose (`<delegate>`,
  //      `<run_state>`, `<tool_calls>`, …) would otherwise render the
  //      raw XML inside the markdown body, since `react-markdown`
  //      escapes unknown XML rather than parsing it. The shared strip
  //      preserves fenced-code regions, so a sub-agent quoting a
  //      literal tag inside ``` ... ``` is left untouched.
  const cleaned = useMemo(
    () => stripDelegatesForDisplay(stripResultEnvelope(text)),
    [text]
  );

  // Tail-stick refs. While the worker is streaming we keep the body
  // pinned to the latest delta, but only if the user hasn't scrolled
  // away. Mirrors the orchestrator-level `ReasoningLineRow` pattern.
  const { bodyRef, onBodyScroll } = useScrollTailStick(cleaned, {
    active: !done
  });

  // The worker may emit a turn whose entire body IS the envelope —
  // common when the model inlines the result directly without prose
  // narration. Skip rendering an empty panel in that case so the
  // structured `SubAgentResult` is the sole surface for the close
  // payload; the trace card's other components still carry the
  // worker's identity, status, and steps.
  if (cleaned.length === 0) return null;

  // Streaming signal is carried by gold phase headings on the status
  // row / reasoning header — never on a markdown body.
  return (
    <div
      ref={bodyRef}
      onScroll={onBodyScroll}
      className={cn(
        'vyotiq-stepfade-once overflow-y-auto px-2 py-0.5 text-text-secondary',
        TEXT_BODY_MAX_H
      )}
    >
      <StreamingMarkdownBody
        text={cleaned}
        done={done}
        className="text-row leading-relaxed text-text-secondary"
      />
    </div>
  );
}
