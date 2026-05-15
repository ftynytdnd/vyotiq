/**
 * Diff renderer for the `edit` tool. Shared between three surfaces:
 *
 *   1. Authoritative result diff — `result.data.hunks` from a
 *      successful tool execution. Variant: `'authoritative'`.
 *   2. Pre-result preview — synthesized from the call's own
 *      `oldString` / `newString` while the tool is still running.
 *      Variant: `'preview'`.
 *   3. Failed-call "intended diff" — same synthesis as (2), but
 *      shown alongside an error pane so the user can see exactly
 *      what the model TRIED to do. Variant: `'preview'`.
 *
 * Visual rules:
 *   - Identical layout for all three variants (single source of
 *     truth for hunk styling, line caps, overflow row).
 *   - The `variant` is exposed as `data-variant` on the outer
 *     container so the EditInvocation tests can assert the
 *     transition without scraping class names.
 *   - When `variant === 'authoritative'`, each hunk container is
 *     stamped with the `vyotiq-diff-settle` class + a
 *     `--vyotiq-hunk-idx` custom property so the CSS keyframe in
 *     `index.css` cascades the reveal. Reduced-motion users see
 *     the existing instant render (the keyframe is gated by
 *     `prefers-reduced-motion: no-preference`).
 *   - When `variant === 'preview'`, no settle class — the row's
 *     shimmer cadence in `InvocationShell` already signals
 *     in-flight state.
 *
 * Caps (preserved from the previous inline `Hunk` component):
 *   - `MAX_VISIBLE_HUNKS = 30`
 *   - `MAX_VISIBLE_LINES_PER_HUNK = 200`
 *
 * Materializing every line as a separately-styled div is expensive
 * enough that a single 1000-line edit could stutter the timeline
 * scroll; the caps keep DOM size bounded.
 */

import { useId, useMemo, useState } from 'react';
import { Copy, Check } from 'lucide-react';
import type { DiffHunk, DiffLine } from '@shared/types/tool.js';
import { cn } from '../../../../lib/cn.js';

/** Cap on hunks rendered into the DOM per diff. */
const MAX_VISIBLE_HUNKS = 30;
/** Cap on lines rendered inside each hunk's `<pre>`. */
const MAX_VISIBLE_LINES_PER_HUNK = 200;

type DiffViewVariant = 'preview' | 'authoritative' | 'partial';

interface EditDiffViewProps {
  hunks: DiffHunk[];
  /**
   * Drives the data-variant attr (testable) and whether the
   * staggered settle animation is applied. Preview variants
   * intentionally skip the animation so the row's existing
   * shimmer is the only motion signal while in flight.
   */
  variant: DiffViewVariant;
}

export function EditDiffView({ hunks, variant }: EditDiffViewProps) {
  // A unique id per mount drives the CSS animation's `key` slot via
  // the wrapping component. `useId` is React 18+ and stable per
  // instance — re-renders preserve the same value, so the animation
  // doesn't re-trigger on every state change inside the same tree.
  const instanceId = useId();
  // "Show all" mode lifts the per-mount caps so very large diffs are
  // viewable on demand. Scoped to this mount only — refreshing or
  // toggling the parent re-collapses, matching the plan's
  // single-shot-per-render contract.
  const [showAll, setShowAll] = useState(false);
  const visibleHunks = showAll ? hunks : hunks.slice(0, MAX_VISIBLE_HUNKS);
  const overflowHunks = hunks.length - visibleHunks.length;

  // Plain-text representation of the diff (for clipboard). Memoised
  // on the hunks reference so the cost is paid once per settle. The
  // format mirrors a standard unified diff so the result is useful
  // outside the app (e.g. pasted into a code review).
  const plainText = useMemo(() => hunksToPlainText(hunks), [hunks]);

  return (
    <div
      data-variant={variant}
      data-edit-diff-instance={instanceId}
      className="group/diff scrollbar-stealth relative flex max-h-96 flex-col gap-2 overflow-auto rounded-inner bg-surface-overlay px-2 py-2"
    >
      {/* Copy-diff affordance — only meaningful when there's hunk
          content to copy, and hidden on the streaming partial
          variant (the bytes are still incoming). */}
      {variant !== 'partial' && hunks.length > 0 && (
        <CopyDiffButton text={plainText} />
      )}
      {visibleHunks.map((hunk, i) => (
        <Hunk key={i} hunk={hunk} idx={i} variant={variant} />
      ))}
      {overflowHunks > 0 && (
        <button
          type="button"
          onClick={() => setShowAll(true)}
          className={cn(
            'self-start rounded-inner px-2 py-0.5 text-meta italic',
            'text-text-faint hover:text-text-secondary hover:bg-surface-hover',
            'transition-colors duration-150'
          )}
        >
          … {overflowHunks} more hunk{overflowHunks === 1 ? '' : 's'} — show all
        </button>
      )}
    </div>
  );
}

/**
 * Hover-reveal copy button placed in the diff card's top-right
 * corner. Uses `navigator.clipboard.writeText` (Electron renderer
 * has it) with a synchronous fallback to `document.execCommand` for
 * robustness on locked-down policies. Shows a brief checkmark when
 * the write succeeds.
 */
function CopyDiffButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  const onCopy = async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        // Fallback. Marked deprecated but still works everywhere we
        // ship; the modern clipboard API path above is preferred.
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      setDone(true);
      setTimeout(() => setDone(false), 1200);
    } catch {
      /* Silent — clipboard denied; the user can still select text. */
    }
  };
  return (
    <button
      type="button"
      onClick={onCopy}
      title={done ? 'Copied' : 'Copy diff'}
      aria-label={done ? 'Copied' : 'Copy diff'}
      className={cn(
        'absolute right-1.5 top-1.5 z-10 inline-flex h-6 w-6 items-center justify-center',
        'rounded-inner text-text-faint transition-opacity duration-150',
        'opacity-0 group-hover/diff:opacity-100 focus:opacity-100',
        'hover:bg-surface-hover hover:text-text-secondary'
      )}
    >
      {done
        ? <Check className="h-3.5 w-3.5" strokeWidth={2.25} />
        : <Copy className="h-3.5 w-3.5" strokeWidth={2.25} />}
    </button>
  );
}

/** Serialise the hunk array into a unified-diff plain-text body. */
function hunksToPlainText(hunks: DiffHunk[]): string {
  const out: string[] = [];
  for (const h of hunks) {
    out.push(`@@ -${h.oldStart} +${h.newStart} @@`);
    for (const l of h.lines) {
      out.push(`${l.kind}${l.text}`);
    }
  }
  return out.join('\n');
}

/**
 * Word-level diff between two adjacent `-` / `+` lines. Used to
 * highlight only the changed sub-spans instead of staining the whole
 * line, which is the dominant UX pattern in 2026 diff viewers
 * (Cursor, Linear, GitHub side-by-side).
 *
 * Strategy: split on word boundaries, find the longest common prefix
 * and suffix, and treat the middle as the "changed" span. Cheap
 * enough to run inline on every hunk — `O(min(|a|, |b|))` per pair.
 * Returns `null` when the lines differ too much for word-level
 * highlighting to be useful (the heuristic: both prefix and suffix
 * lengths are 0).
 */
interface IntraLineHighlight {
  prefix: string;
  changed: string;
  suffix: string;
}

function intraLineDiff(oldText: string, newText: string): {
  old: IntraLineHighlight;
  new: IntraLineHighlight;
} | null {
  const a = oldText;
  const b = newText;
  let pre = 0;
  const maxPre = Math.min(a.length, b.length);
  while (pre < maxPre && a.charCodeAt(pre) === b.charCodeAt(pre)) pre++;
  let suf = 0;
  const maxSuf = Math.min(a.length - pre, b.length - pre);
  while (
    suf < maxSuf &&
    a.charCodeAt(a.length - 1 - suf) === b.charCodeAt(b.length - 1 - suf)
  ) {
    suf++;
  }
  if (pre === 0 && suf === 0) return null; // entirely different — keep line-level stain
  return {
    old: { prefix: a.slice(0, pre), changed: a.slice(pre, a.length - suf), suffix: a.slice(a.length - suf) },
    new: { prefix: b.slice(0, pre), changed: b.slice(pre, b.length - suf), suffix: b.slice(b.length - suf) }
  };
}

interface HunkProps {
  hunk: DiffHunk;
  idx: number;
  variant: DiffViewVariant;
}

function Hunk({ hunk, idx, variant }: HunkProps) {
  const visibleLines = hunk.lines.slice(0, MAX_VISIBLE_LINES_PER_HUNK);
  const hiddenCount = hunk.lines.length - visibleLines.length;
  // Staggered settle is reserved for authoritative diffs. Preview
  // and partial diffs already have row-level shimmer signalling
  // in-flight state; layering a settle on top of that would read
  // as a double-animation.
  const settle = variant === 'authoritative';
  // In `partial` mode, the very last `+` or `-` line is the one the
  // model is actively streaming bytes into. We tag it so we can
  // render a trailing blinking cursor at its tail — the same idiom
  // Cursor / Windsurf use to telegraph "more incoming".
  const lastStreamingIdx =
    variant === 'partial'
      ? findLastStreamingLineIdx(visibleLines)
      : -1;

  // Precompute word-level intra-line highlights for adjacent `-` / `+`
  // line pairs. We keep two maps (by visible index) so the row
  // renderer can look up its own span split in O(1).
  //
  // Phase 1.3: with the LCS-based synthesis the partial variant now
  // produces structurally meaningful pairs (anchor lines stay as ` `
  // context, edits land as adjacent `-`/`+`), so word-level diffs
  // are actually useful while streaming. We still skip the streaming
  // tip — its bytes are still arriving, intra-line highlighting on
  // a truncated line would flicker as more bytes arrive.
  const intraLineMap = useMemo(
    () => buildIntraLineMap(visibleLines, lastStreamingIdx),
    [visibleLines, lastStreamingIdx]
  );

  return (
    <div
      className={cn('flex flex-col', settle && 'vyotiq-diff-settle')}
      // CSS reads `--vyotiq-hunk-idx` to compute the per-hunk
      // animation delay. Setting it via inline style avoids
      // hard-coding a fixed stagger per row in CSS.
      style={
        settle
          ? ({ '--vyotiq-hunk-idx': idx } as React.CSSProperties)
          : undefined
      }
    >
      {/* Sticky hunk header so a long-hunk scroll keeps the line
          numbers visible. `top-0` is relative to the diff card's own
          `overflow-auto` container. */}
      <div className="sticky top-0 z-[1] bg-surface-overlay font-mono text-meta text-text-faint">
        @@ -{hunk.oldStart} +{hunk.newStart} @@
      </div>
      <pre className="whitespace-pre font-mono text-row leading-relaxed">
        {visibleLines.map((l, i) => {
          const intra = intraLineMap.get(i);
          return (
            <div
              key={i}
              className={cn(
                'px-1',
                // Use a softer line tint when intra-line highlights
                // exist; the high-contrast token-level stain takes
                // over for the changed span.
                l.kind === '+' && (intra ? 'bg-success/[0.05] text-success' : 'bg-success/10 text-success'),
                l.kind === '-' && (intra ? 'bg-danger/[0.05] text-danger' : 'bg-danger/10 text-danger'),
                l.kind === ' ' && 'text-text-secondary'
              )}
            >
              <span className="mr-1 select-none">{l.kind}</span>
              {intra ? (
                <>
                  {intra.prefix}
                  <span className={cn(
                    'rounded-[2px] px-px',
                    l.kind === '+' ? 'bg-success/25' : 'bg-danger/25'
                  )}>
                    {intra.changed}
                  </span>
                  {intra.suffix}
                </>
              ) : (
                l.text
              )}
              {i === lastStreamingIdx && (
                <span
                  aria-hidden="true"
                  className="vyotiq-stream-cursor ml-px inline-block h-[1em] w-[0.55ch] align-text-bottom"
                />
              )}
            </div>
          );
        })}
      </pre>
      {hiddenCount > 0 && (
        <div className="px-1 font-mono text-meta italic text-text-faint">
          … {hiddenCount} more line{hiddenCount === 1 ? '' : 's'} in this hunk
        </div>
      )}
    </div>
  );
}

/**
 * Walk a hunk's visible lines and pair adjacent `-` / `+` lines for
 * intra-line word highlighting. Each pair contributes TWO entries to
 * the map keyed by the visible index of the `-` and the `+` lines
 * respectively. Lines without a paired counterpart (lone `-`, lone
 * `+`, or any ` ` context line) get no entry and fall back to the
 * line-level stain.
 *
 * `streamingTipIdx` is the index of the line currently being
 * streamed (Phase 1.3). When non-negative, that line is excluded
 * from pairing — its bytes are still arriving and intra-line word
 * highlights on a truncated line flicker on every delta. The line's
 * counterpart in the same `-/+` pair is also excluded so we never
 * partial-highlight one side of a pair against a stale tip.
 */
function buildIntraLineMap(
  lines: readonly DiffLine[],
  streamingTipIdx: number = -1
): Map<number, IntraLineHighlight> {
  const out = new Map<number, IntraLineHighlight>();
  for (let i = 0; i < lines.length - 1; i++) {
    const a = lines[i]!;
    const b = lines[i + 1]!;
    if (a.kind !== '-' || b.kind !== '+') continue;
    if (streamingTipIdx === i || streamingTipIdx === i + 1) {
      // Skip the streaming tip pair entirely; the cursor + plain
      // text rendering carries the in-flight signal.
      i++;
      continue;
    }
    const pair = intraLineDiff(a.text, b.text);
    if (!pair) continue;
    out.set(i, pair.old);
    out.set(i + 1, pair.new);
    // Skip the `+` we just paired so a pathological `-+ -+` block
    // doesn't pair across the boundary.
    i++;
  }
  return out;
}

/** Index of the LAST `+` / `-` line in a hunk — the streaming tip. */
function findLastStreamingLineIdx(lines: readonly { kind: string }[]): number {
  for (let i = lines.length - 1; i >= 0; i--) {
    const k = lines[i]?.kind;
    if (k === '+' || k === '-') return i;
  }
  return -1;
}
