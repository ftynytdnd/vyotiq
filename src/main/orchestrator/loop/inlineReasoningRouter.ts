/**
 * Streaming router that reclassifies inline chain-of-thought blocks
 * (`<think>...`, `<thinking>...`, `<reasoning>...`, `<reflection>...`)
 * from the assistant *content* channel into the *reasoning* channel.
 *
 * Why this exists
 * ---------------
 * Some providers (DeepSeek-R1 native, Ollama with `thinking: true`) surface
 * the model's chain-of-thought through a dedicated `reasoning_content` /
 * `thinking` field — `consumeChatStream` already routes those into a
 * `reasoningDelta`, and the renderer's `ReasoningLineRow` collapses them
 * behind the "Thought for Ns" disclosure.
 *
 * Other providers — and many models prompted to "think before answering"
 * (Qwen-3, GPT-OSS, Llama variants, R1 distilled models behind a generic
 * OpenAI-compat shim) — do not have a separate reasoning channel: they
 * emit the chain-of-thought as plain content text wrapped in inline XML
 * tags. The exact tag name varies by model and prompt:
 *
 *   - `<think>` / `<thinking>`   — Anthropic-style "extended thinking"
 *                                  prompts, Qwen-3, GPT-OSS, R1 distill
 *   - `<reasoning>`              — Common in custom CoT prompt templates
 *                                  (matches the `reasoning_content`
 *                                  channel name some providers use)
 *   - `<reflection>`             — Reflection-prompt variants
 *
 * Without this router any of these tags leak into the rendered timeline
 * as visible XML with the chain-of-thought above the actual answer (see
 * the original screenshot bug report and the `<reasoning>` follow-up).
 *
 * Adding a new opener variant is a one-line change to `OPENERS` below
 * — the router logic itself is shape-agnostic.
 *
 * Strategy
 * --------
 * The router is a streaming finite-state machine fed by raw content
 * deltas. For every chunk it returns the bytes that belong to the user-
 * facing text channel and the bytes that belong to the reasoning panel,
 * without ever emitting a half-formed tag (partial-tag bytes are buffered
 * until the next chunk completes or refutes them).
 *
 * Modes:
 *   - 'text'      → bytes flow to `text`. We watch for any recognised
 *                   opener.
 *   - 'thinking'  → bytes flow to `reasoning`. We watch for the matching
 *                   closer ONLY (e.g. `</reasoning>` cannot close a
 *                   `<think>...` block). The opener variant is
 *                   remembered so mismatched closers stay opaque.
 *
 * Code-fence safety:
 *   Markdown fenced code blocks (``` ... ``` and ~~~ ... ~~~) are tracked.
 *   While inside a fence the router behaves as a pass-through — a user
 *   asking the model to *quote* a recognised tag inside a code block
 *   sees it untouched. State is per-instance and survives chunk
 *   boundaries.
 *
 * Case-insensitive matching: providers occasionally up-case the tag
 * (`<Thinking>`, `<Reasoning>`); we normalise comparisons to lower case.
 *
 * The router is intentionally pure (no I/O, no logging, no clocks) so
 * `consumeChatStream` can wrap it without any new failure modes, and the
 * unit tests can drive it directly with synthetic delta sequences.
 */

interface OpenSpec {
  /** Lower-cased opener tag including angle brackets, e.g. `<thinking>`. */
  open: string;
  /** Lower-cased closer that pairs with this opener, e.g. `</thinking>`. */
  close: string;
}

/**
 * Recognised inline chain-of-thought tag variants. Order is stable but
 * NOT meaningful: the search picks the earliest-occurring opener in the
 * work string regardless of list position. Adding a new variant is a
 * one-line append; the router logic is shape-agnostic.
 *
 * Constraints when adding:
 *   - Lower-case spelling (matching is case-insensitive but the table
 *     stores the lower form).
 *   - The opener must START with `<` and the closer with `</` — the
 *     partial-tag detector relies on these prefixes.
 *   - The tag name must NOT collide with a tag the model legitimately
 *     emits as user-facing content (e.g. don't add `<note>` here).
 */
const OPENERS: readonly OpenSpec[] = [
  { open: '<thinking>', close: '</thinking>' },
  { open: '<think>', close: '</think>' },
  { open: '<reasoning>', close: '</reasoning>' },
  { open: '<reflection>', close: '</reflection>' }
] as const;

/** Longest tag length used to bound the partial-tag tail buffer. */
const MAX_TAG_LEN = OPENERS.reduce(
  (m, o) => Math.max(m, o.open.length, o.close.length),
  0
);

/** Markdown fence markers we recognise. */
const FENCE_TICK = '```';
const FENCE_TILDE = '~~~';

export interface RouterOutput {
  /** Bytes destined for the user-facing assistant text stream. */
  text: string;
  /** Bytes destined for the reasoning panel stream. */
  reasoning: string;
}

/**
 * Locate the earliest case-insensitive occurrence of any candidate string
 * inside `haystack` starting at `from`. Returns the matching index and
 * candidate, or `null` if none found. Linear in `haystack.length` × the
 * (tiny, fixed) candidate count.
 */
function findFirstOf(
  haystackLower: string,
  candidates: readonly string[],
  from: number
): { index: number; match: string } | null {
  let bestIdx = -1;
  let bestMatch: string | null = null;
  for (const c of candidates) {
    const i = haystackLower.indexOf(c, from);
    if (i === -1) continue;
    if (bestIdx === -1 || i < bestIdx) {
      bestIdx = i;
      bestMatch = c;
    }
  }
  return bestMatch === null ? null : { index: bestIdx, match: bestMatch };
}

/**
 * Returns the offset at which a trailing partial-tag prefix starts, or
 * `-1` if the work string has no held-back tail. A "partial" is any
 * suffix of `work` that is itself a strict prefix of one of `tags`.
 *
 * Example: with tags `['<thinking>']` and work `"hello <thi"`, returns
 * `6` — the caller will emit `"hello "` and hold `"<thi"` for the next
 * feed.
 */
function findPartialTagStart(
  workLower: string,
  tags: readonly string[]
): number {
  const maxLen = Math.min(MAX_TAG_LEN - 1, workLower.length);
  for (let len = maxLen; len >= 1; len--) {
    const tail = workLower.slice(workLower.length - len);
    if (tail[0] !== '<') continue;
    for (const t of tags) {
      // Must be a strict prefix (not the full tag — the full tag would
      // have been matched by the complete-tag scan first).
      if (t.length > tail.length && t.startsWith(tail)) {
        return workLower.length - len;
      }
    }
  }
  return -1;
}

/**
 * Returns the offset at which a trailing partial fence marker starts, or
 * `-1`. A complete fence requires three identical chars (``` or ~~~).
 * One or two trailing backticks/tildes could grow into a fence on the
 * next chunk, so we hold them.
 */
function findPartialFenceStart(work: string): number {
  if (work.length === 0) return -1;
  const lastChar = work[work.length - 1];
  if (lastChar !== '`' && lastChar !== '~') return -1;
  // Count trailing run of the same character, up to 2 (3+ would be a
  // complete fence and handled by the main scan).
  let i = work.length - 1;
  let count = 0;
  while (i >= 0 && work[i] === lastChar && count < 2) {
    i--;
    count++;
  }
  return work.length - count;
}

export class InlineReasoningRouter {
  private mode: 'text' | 'thinking' = 'text';
  /** Set when in 'thinking' mode — which closer we're looking for. */
  private currentClose: string | null = null;
  /** Held tail bytes that might be the start of a tag or fence. */
  private tail = '';
  /** True while inside a markdown fenced code block. */
  private inFence = false;
  /** The opener marker (``` or ~~~) when `inFence` is true. */
  private fenceMarker: string | null = null;

  /**
   * Feed a content delta. Returns the bytes routed to the text channel
   * and the bytes routed to the reasoning channel for this chunk.
   *
   * Empty input is a no-op. Output may be empty in either field if the
   * entire chunk was held back as a partial tag/fence prefix.
   */
  feed(chunk: string): RouterOutput {
    if (chunk.length === 0) return { text: '', reasoning: '' };

    const out: RouterOutput = { text: '', reasoning: '' };
    let work = this.tail + chunk;
    this.tail = '';

    while (work.length > 0) {
      // Inside a fenced code block: pass through to the active channel
      // (text or reasoning) verbatim until the closing fence.
      if (this.inFence) {
        const marker = this.fenceMarker!;
        const idx = work.indexOf(marker);
        if (idx >= 0) {
          this.appendToActiveChannel(out, work.slice(0, idx + marker.length));
          this.inFence = false;
          this.fenceMarker = null;
          work = work.slice(idx + marker.length);
          continue;
        }
        // No closing fence in this chunk: emit safely, holding only a
        // potential partial-fence tail.
        const partial = findPartialFenceStart(work);
        if (partial >= 0) {
          this.appendToActiveChannel(out, work.slice(0, partial));
          this.tail = work.slice(partial);
        } else {
          this.appendToActiveChannel(out, work);
        }
        return out;
      }

      const lower = work.toLowerCase();

      if (this.mode === 'text') {
        const opener = findFirstOf(
          lower,
          OPENERS.map((o) => o.open),
          0
        );
        const fenceTick = lower.indexOf(FENCE_TICK);
        const fenceTilde = lower.indexOf(FENCE_TILDE);
        const fenceIdx =
          fenceTick === -1
            ? fenceTilde
            : fenceTilde === -1
              ? fenceTick
              : Math.min(fenceTick, fenceTilde);

        // Whichever lands first (tag vs fence) wins. If neither lands, we
        // hold any trailing partial and bail.
        const openerIdx = opener?.index ?? -1;
        if (openerIdx === -1 && fenceIdx === -1) {
          const tagPartial = findPartialTagStart(
            lower,
            OPENERS.map((o) => o.open)
          );
          const fencePartial = findPartialFenceStart(work);
          const partial =
            tagPartial === -1
              ? fencePartial
              : fencePartial === -1
                ? tagPartial
                : Math.min(tagPartial, fencePartial);
          if (partial >= 0) {
            out.text += work.slice(0, partial);
            this.tail = work.slice(partial);
          } else {
            out.text += work;
          }
          return out;
        }

        const tagFirst =
          fenceIdx === -1 || (openerIdx !== -1 && openerIdx < fenceIdx);
        if (tagFirst && opener) {
          out.text += work.slice(0, opener.index);
          const spec = OPENERS.find((o) => o.open === opener.match)!;
          this.mode = 'thinking';
          this.currentClose = spec.close;
          work = work.slice(opener.index + opener.match.length);
          continue;
        }

        // Fence opens first.
        const fenceMarker = work.slice(fenceIdx, fenceIdx + 3);
        out.text += work.slice(0, fenceIdx + 3);
        this.inFence = true;
        this.fenceMarker = fenceMarker;
        work = work.slice(fenceIdx + 3);
        continue;
      }

      // mode === 'thinking'
      const closer = this.currentClose!;
      const idx = lower.indexOf(closer);
      if (idx >= 0) {
        out.reasoning += work.slice(0, idx);
        this.mode = 'text';
        this.currentClose = null;
        work = work.slice(idx + closer.length);
        continue;
      }
      // No closer in this chunk: emit safely, holding any partial closer
      // tail. We do NOT honor fence markers inside a thinking block —
      // the entire thinking payload is opaque reasoning text.
      const partial = findPartialTagStart(lower, [closer]);
      if (partial >= 0) {
        out.reasoning += work.slice(0, partial);
        this.tail = work.slice(partial);
      } else {
        out.reasoning += work;
      }
      return out;
    }

    return out;
  }

  /**
   * Drain any held tail at end-of-stream. The tail by definition could
   * not have completed a tag, so we route it to whichever channel is
   * currently active. Idempotent.
   */
  flush(): RouterOutput {
    const out: RouterOutput = { text: '', reasoning: '' };
    if (this.tail.length === 0) return out;
    if (this.mode === 'thinking') out.reasoning = this.tail;
    else out.text = this.tail;
    this.tail = '';
    return out;
  }

  /** Whether the router is currently inside a `<think>` / `<thinking>` block. */
  isInThinking(): boolean {
    return this.mode === 'thinking';
  }

  private appendToActiveChannel(out: RouterOutput, s: string): void {
    if (this.mode === 'thinking') out.reasoning += s;
    else out.text += s;
  }
}
