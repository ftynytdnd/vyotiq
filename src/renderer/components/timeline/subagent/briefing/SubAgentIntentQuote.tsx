/**
 * SubAgentIntentQuote — renders the orchestrator's natural-language
 * paragraph that introduced this sub-agent's `<delegate />`
 * directive. Sourced via `deriveDelegateContext` from the reducer's
 * orchestrator-level `assistantTexts` accumulator; the helper is
 * pure, so this component reads from the chat store via a memo'd
 * selector.
 *
 * Behaviour:
 *   - Renders nothing when no intent prose can be recovered (e.g.
 *     directive at the start of the turn). The Briefing remains
 *     coherent without an empty heading.
 *   - Strips orchestration markup via `stripDelegatesForDisplay`
 *     so a paragraph that mentions another delegate inline still
 *     reads cleanly.
 *   - Markdown-rendered (the orchestrator commonly writes inline
 *     `code` and **emphasis** in its planning prose).
 *
 * Performance note: the selector returns the result of running
 * `deriveDelegateContext` against the live store — Zustand only
 * re-renders the consumer when the SELECTED value's shallow shape
 * changes. Pre-fix the selector returned the entire orchestrator
 * `assistantTexts` map, so every text-delta event (which replaces
 * that reference immutably) re-rendered every expanded
 * `SubAgentIntentQuote` and ran the full scan again. Running the
 * derivation INSIDE the selector lets Zustand short-circuit when
 * the derived `{ intentText, orchestratorTurnId }` is unchanged
 * (typical case: text-deltas landing on turns that don't carry
 * this sub-agent's directive). The selector itself is cheap once
 * the regex is warm in `deriveDelegateContext`'s opener cache; it
 * runs on every store mutation but doesn't trigger React work
 * unless the result actually changed.
 */

import { useShallow } from 'zustand/react/shallow';
import { Quote } from 'lucide-react';
import { stripDelegatesForDisplay } from '@shared/text/strip.js';
import { useChatStore } from '../../../../store/useChatStore.js';
import { MarkdownBody } from '../../markdown/MarkdownBody.js';
import { DetailPane } from '../../tools/shared/DetailPane.js';
import { SurfaceShell } from '../../../ui/SurfaceShell.js';
import { deriveDelegateContext } from './deriveDelegateContext.js';

interface SubAgentIntentQuoteProps {
  subagentId: string;
}

/**
 * Matches any XML/HTML-like opener, closer, or self-closing tag.
 * Used to detect "render-empty" intents: prose that, after stripping
 * orchestration markup, consists ONLY of unknown HTML-like tags
 * (e.g. `<Cargo.toml>`, `<File>`, JSX-style fragments). React-
 * Markdown without `rehype-raw` silently drops such tags during
 * rendering — surface the gate here so we never paint an empty
 * `DetailPane` chrome around invisible content.
 */
const TAG_LIKE_RE = /<\/?[\w.:-]+\b[^>]*\/?>/g;

function hasRenderableProse(s: string): boolean {
  return /\w/.test(s.replace(TAG_LIKE_RE, ''));
}

export function SubAgentIntentQuote({ subagentId }: SubAgentIntentQuoteProps) {
  // `useShallow` returns the same wrapper object identity when the
  // selected `{ intentText, orchestratorTurnId }` pair shallow-
  // equals the previous result. That means text-deltas on turns
  // that don't carry this worker's directive — or text-deltas that
  // don't change the trailing paragraph the helper extracts — skip
  // the React reconciliation entirely.
  const ctx = useChatStore(
    useShallow((s) => deriveDelegateContext(s.assistantTexts, subagentId))
  );

  if (!ctx.intentText) return null;
  const cleaned = stripDelegatesForDisplay(ctx.intentText);
  // Two-tier emptiness gate: first the cheap whitespace check, then
  // the renderable-prose check that also excludes tag-only content
  // which react-markdown would drop silently. Both gates suppress
  // the entire `DetailPane` so the user never sees an empty
  // "Orchestrator intent" rail.
  if (cleaned.trim().length === 0) return null;
  if (!hasRenderableProse(cleaned)) return null;

  return (
    <DetailPane label="orchestrator intent">
      <SurfaceShell padded padding="content">
        <div className="flex items-start gap-2">
          <Quote
            className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent/80"
            strokeWidth={2}
          />
          <MarkdownBody
            text={cleaned}
            className="min-w-0 flex-1 text-row italic leading-relaxed text-text-secondary"
          />
        </div>
      </SurfaceShell>
    </DetailPane>
  );
}
