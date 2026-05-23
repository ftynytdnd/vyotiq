/**
 * Context summarization types — shared between main and renderer.
 *
 * The orchestrator accumulates an unbounded `ChatMessage[]` across a
 * long-running conversation (per-iteration assistant turns, tool
 * results capped at 8 KB each, replayed history, delegate results).
 * Two protection layers were already in place before this module:
 *
 *   - The iteration cap (`MAX_TOTAL_ITERATIONS = 24`) bounds a single
 *     run.
 *   - The per-tool-result cap (`MAX_TOOL_OUTPUT_CHARS = 8000`) bounds
 *     individual tool messages.
 *
 * Neither bounds a long *conversation* across many turns — by turn 30
 * a real refactor session can easily push 100k+ tokens. This module
 * introduces a third layer: host-controlled summarization that
 * compresses a configurable middle slice of `messages[]` into a
 * single synthetic `<context_summary>` system envelope, leaving the
 * head (first system / preserved invariants) and tail (recent turns)
 * verbatim.
 *
 * Sub-agents are intentionally excluded. Their fresh-context, single-
 * task, hard-iteration-capped design (see `04-subagent-prompt.md` +
 * `SUBAGENT_MAX_ITERATIONS`) keeps their footprint inside any modern
 * provider's window without this layer; introducing it would violate
 * the strict context-isolation Prime Directive (project.md §"Sub-
 * Agent Delegation" #3).
 */

import type { ModelSelection } from './provider.js';

/**
 * Coarse classification of an entry in the orchestrator's
 * `messages: ChatMessage[]` array. Used by `ContextSummaryRules.
 * perKindPolicy` to let the user (and the auto-trigger) reason about
 * categories rather than individual entries.
 *
 *   - `user`         — `role:'user'` (turn envelope).
 *   - `assistant`    — `role:'assistant'` with plain `content`.
 *   - `assistant-tool-call` — `role:'assistant'` with `tool_calls`.
 *     Persisted as its own kind because it MUST stay paired with
 *     every matching `role:'tool'` reply (strict OpenAI compat).
 *   - `tool-result`  — `role:'tool'` with a `tool_call_id`.
 *   - `delegate-result` — synthetic `role:'user'` envelope the
 *     orchestrator injects after a `<delegate>` round resolves. The
 *     content is bracketed by `<subagent_results>` (see
 *     `buildSubagentResultsEnvelope`) so the classifier can detect
 *     it by checking the start of the body. The kind name keeps
 *     the older `delegate-result` token for backward compatibility
 *     with persisted `perKindPolicy` shapes in user settings.
 *     These envelopes are large by definition (sub-agent `<result>`
 *     bodies can be multi-KB) so they're prime summarization
 *     candidates.
 *   - `system-summary` — synthetic `role:'system'` envelope this
 *     module previously emitted. Surfaced as its own kind so the
 *     user can explicitly opt into recursive compression (default
 *     `'keep'` — never re-summarize unless asked).
 */
export type MessageKind =
  | 'user'
  | 'assistant'
  | 'assistant-tool-call'
  | 'tool-result'
  | 'delegate-result'
  | 'system-summary';

/**
 * Per-message user override applied on top of the policy table. Set
 * by the Inspector's Keep / Summarize / Drop toggle.
 *
 *   - `'keep'`        — never include in the summarizable range, even
 *     when the policy table says `'summarize'`.
 *   - `'summarize'`   — always include in the summarizable range, even
 *     when the policy table says `'keep'`.
 *   - `'drop'`        — never include in the next request at all, with
 *     or without summarization. The summary still references the
 *     dropped messages by id in its `droppedMessageIds` slot so the
 *     audit trail is complete.
 *
 * Persistence: stored in the conversation's JSONL transcript via the
 * `context-override-set` event kind so overrides survive renderer
 * reloads, conversation switches, and app restarts.
 */
/**
 * Runtime tuple of allowed override values. The TypeScript type
 * `ContextMessageOverride` is derived from this so the wire-shape
 * validator (`assertEnum` in `contextSummary.ipc.ts`) and the type
 * system stay in lockstep — adding a new override here flows through
 * to both the renderer's toggle and the IPC handler's allow-list
 * without a second source of truth to drift.
 *
 * Mirrors the `PROVIDER_DIALECTS` pattern in `./provider.ts`.
 */
export const CONTEXT_MESSAGE_OVERRIDES = [
  'keep',
  'summarize',
  'drop'
] as const;
export type ContextMessageOverride = (typeof CONTEXT_MESSAGE_OVERRIDES)[number];

/**
 * Per-kind summarization policy. Used as the "default" decision for a
 * message of that kind when the user hasn't set an explicit override.
 *
 *   - `'keep'`      — preserve verbatim in the summarizable window's
 *     `preserved` set.
 *   - `'summarize'` — eligible for summarization when the window has
 *     enough budget.
 *   - `'drop'`      — never sent to the model from this turn forward.
 *   - `'auto'`      — apply the host's built-in heuristic: small
 *     entries (< ~512 chars) are preserved, large ones are
 *     summarized. Mirrors the existing "small replies cost nothing,
 *     big dumps are wasteful" rule of thumb.
 */
export type ContextMessageKindPolicy = 'keep' | 'summarize' | 'drop' | 'auto';

/**
 * Visual marker for messages the user explicitly dropped. The model
 * never sees the dropped content; this only governs whether a tiny
 * placeholder hint is emitted in their place inside the summary
 * envelope so the agent knows *something* used to be there.
 *
 *   - `'omit'`        — dropped messages produce no marker. Cleanest
 *     wire shape; the agent sees a tight summary with no holes.
 *   - `'placeholder'` — a short `[user-dropped: kind, ~N chars]`
 *     line appears inside the summary for each dropped message.
 *     Useful when the user wants the agent to know there are gaps
 *     in its memory.
 */
export type DroppedMarkerStyle = 'omit' | 'placeholder';

/**
 * Full configuration. Three layers compose in `selectEffectiveRules`:
 *   1. `DEFAULT_CONTEXT_SUMMARY_RULES` (build-time default).
 *   2. `AppSettings.contextSummary`   (global user override).
 *   3. `AppSettings.ui.contextSummaryByWorkspace[wsId]` (per-workspace
 *      override).
 *
 * Each layer is `Partial`. Every field is independently overridable —
 * the user can pin only the trigger ratio in a workspace while still
 * inheriting the global summarizer model.
 */
export interface ContextSummaryRules {
  /** Master kill switch. When false, the auto-trigger never fires and
   *  manual `triggerManual()` rejects with a structured reason. */
  enabled: boolean;
  /** Fraction of the model's context window after which the auto-
   *  trigger fires. Capped at 0..1 by the resolver. */
  autoTriggerRatio: number;
  /** Most-recent assistant/tool/user turns to leave verbatim at the
   *  tail. A "turn" is anchored by a `role:'user'` message; everything
   *  between two user messages counts as one turn for this rule. */
  keepRecentTurns: number;
  /** Always preserve every `role:'user'` message verbatim, even when
   *  the per-kind policy would summarize them. Default `true` —
   *  user prompts are cheap and dropping them silently rewrites
   *  history. */
  preserveUserPromptsAlways: boolean;
  /** Always preserve the first system message verbatim. The
   *  orchestrator rewrites it per-iteration from harness + envelopes
   *  anyway, but the summarizer still needs to see it as
   *  authoritative context. Default `true`. */
  preserveFirstSystem: boolean;
  /** Skip summarization when the summarizable range has fewer than
   *  this many messages. Avoids burning a provider call to compress
   *  three small turns. */
  minMessagesToSummarize: number;
  /** Provider-call retries the summarizer is allowed before giving
   *  up. Matches the orchestrator's `MAX_SELF_CORRECTION_ATTEMPTS`
   *  pattern. */
  maxRetries: number;
  /**
   * Model to use for summarization. `null` ⇒ use the run's current
   * model (the same `selection` the orchestrator is using). Setting
   * an explicit `ModelSelection` lets the user pick a cheaper/faster
   * model for compaction (e.g. a small local Ollama model while the
   * orchestrator uses Claude).
   */
  summarizerSelection: ModelSelection | null;
  /** Per-MessageKind default policy. Combined with per-message
   *  overrides in `messageWindow.partition`. */
  perKindPolicy: Record<MessageKind, ContextMessageKindPolicy>;
  /** Whether the summary itself emits placeholder markers for
   *  user-dropped messages. See `DroppedMarkerStyle`. */
  droppedMarkerStyle: DroppedMarkerStyle;
}

/**
 * Build-time defaults. Tuned so an out-of-the-box install starts
 * compressing only at 70 % window fullness, preserves the 4 most
 * recent turns, keeps every user prompt verbatim, and never re-
 * summarizes a previous summary unless the user explicitly opts in.
 *
 * Anchored as a `const` (not a function) so the renderer's selector
 * helpers can use referential equality cheaply — the values never
 * change at runtime.
 */
export const DEFAULT_CONTEXT_SUMMARY_RULES: ContextSummaryRules = {
  enabled: true,
  autoTriggerRatio: 0.7,
  keepRecentTurns: 4,
  preserveUserPromptsAlways: true,
  preserveFirstSystem: true,
  minMessagesToSummarize: 6,
  maxRetries: 2,
  summarizerSelection: null,
  perKindPolicy: {
    user: 'keep',
    assistant: 'auto',
    'assistant-tool-call': 'auto',
    'tool-result': 'auto',
    'delegate-result': 'summarize',
    'system-summary': 'keep'
  },
  droppedMarkerStyle: 'omit'
};

/**
 * One row in `ContextInspectorSnapshot.messages`. A flattened view of
 * a `ChatMessage` plus the metadata the Inspector needs to render
 * the per-message toggle. NEVER carries the full `content` —
 * Inspector previews stream a separate IPC call when the user
 * expands a row, so a 32 KB inlined file doesn't bloat every list
 * fetch.
 */
export interface ContextInspectorMessage {
  /** Stable id minted by `messageWindow.identify(messages)`. Pinned
   *  for the run's lifetime so overrides survive iterations. */
  messageId: string;
  /** Wire role from the underlying `ChatMessage`. */
  role: 'system' | 'user' | 'assistant' | 'tool';
  /** Coarse kind classification. */
  kind: MessageKind;
  /** Originating event id (`user-prompt.id`, `assistant-text*.id`,
   *  `tool-call.id`, etc.) — used to cross-reference the message
   *  with the rendered timeline row. Optional because synthetic
   *  entries (summary envelopes, the seed system message) have no
   *  matching timeline event. */
  originEventId?: string;
  /** Short label the Inspector renders: `"tool: read core/x.ts"`,
   *  `"assistant turn 3 (text)"`, etc. */
  originLabel: string;
  /** Best-effort token estimate for this single message via
   *  `tokenCounter.estimateTokens`. The Inspector renders the
   *  number directly and uses it to project the "after" budget. */
  tokenEstimate: number;
  /** Raw character count. Useful for the projection footer and
   *  cheap to compute. */
  charCount: number;
  /** Effective decision after layering the per-kind policy against
   *  the per-message override. Surfaces as the toggle's current
   *  state. */
  effectiveDecision: 'keep' | 'summarize' | 'drop';
  /** Explicit user override, when present. `undefined` ⇒ the
   *  decision came from the per-kind policy. */
  override?: ContextMessageOverride;
  /** True when this row was produced by a prior summarization (the
   *  synthetic `system-summary` envelope). Lets the Inspector mark
   *  it with the "Compressed" badge and gate recursive-compression
   *  affordances behind a confirm. */
  fromSummary?: boolean;
}

/**
 * Inspector snapshot. Computed on demand by `getInspectorSnapshot` in
 * the main-side summarizer module and shipped to the renderer in a
 * single IPC round-trip. Always reflects the LIVE in-memory
 * `messages[]` at the moment of the call, including the head system
 * placeholder the loop rewrites each iteration.
 *
 * `ceiling` and `currentRatio` mirror what the composer's
 * `TokenUsagePill` already shows so the Inspector can render the
 * same gauge without round-tripping through the provider store.
 */
export interface ContextInspectorSnapshot {
  /** Run this snapshot belongs to. Optional because the Inspector
   *  can also be opened against an idle conversation (between
   *  runs) — in that case the snapshot reflects the persisted
   *  initial-messages state. */
  runId?: string;
  /** Conversation this snapshot belongs to. Always set; the
   *  Inspector is unconditionally scoped to one conversation. */
  conversationId: string;
  /** Workspace the conversation belongs to. Needed because the
   *  workspace-override `.vyotiq/context-summarizer.md` resolution
   *  depends on it. */
  workspaceId: string;
  /** Fully-resolved rules (global ← workspace ← session overrides
   *  collapsed). The Inspector's "Rules" header binds to this. */
  rules: ContextSummaryRules;
  /** True when the active workspace has a readable
   *  `.vyotiq/context-summarizer.md` override file; the Inspector
   *  surfaces a small badge in this case. */
  workspaceOverridePresent: boolean;
  /** Flattened message list — see `ContextInspectorMessage`. */
  messages: ContextInspectorMessage[];
  /** Sum of `tokenEstimate` across `messages`. */
  totalTokens: number;
  /** Effective context-window ceiling from the active model.
   *  `undefined` when no ceiling is known (renderer hides the
   *  ratio gauge). */
  ceiling?: number;
  /** Convenience pre-computed `totalTokens / ceiling` (clamped to
   *  `[0, 2]` for the "over-budget" red zone). `undefined` when
   *  the ceiling is unknown. */
  currentRatio?: number;
  /** Id of an in-flight summary, when one is currently streaming
   *  for this run. The Inspector locks the trigger button and
   *  routes its live-card subscription against this id. */
  activeSummaryId?: string;
  /**
   * Phase 5 (2026) — wire breakdown for the Inspector's "Wire
   * breakdown" panel. Splits the prospective payload into
   * system-prompt body, tool-schema JSON, and message bodies so the
   * user can see where the tokens are actually going.
   *
   *   - `systemPromptTokens` = sum of every `role:'system'` message's
   *     token estimate (already counted inside `totalTokens` too).
   *   - `toolSchemaTokens` = tokens of the serialized tool catalogue.
   *     NOT counted in `totalTokens` because the Inspector's message
   *     list only iterates `messages[]` — tools live alongside.
   *   - `bodyTokens` = sum of every non-system message's token
   *     estimate (also a subset of `totalTokens`).
   *   - `total` = `systemPromptTokens + toolSchemaTokens + bodyTokens`
   *     — the authoritative total that the WIRE will see for the
   *     next request. May exceed `totalTokens` by `toolSchemaTokens`.
   *
   * Always present so the Inspector renders the section
   * unconditionally; zeros are valid (empty conversation).
   */
  framing: {
    systemPromptTokens: number;
    toolSchemaTokens: number;
    bodyTokens: number;
    total: number;
    /**
     * Per-envelope breakdown of `systemPromptTokens` so the Inspector
     * can foldably surface where the system-prompt budget actually
     * goes. The first row is always `"Harness body"` (the static
     * directives + tool catalogue + runtime-limits prose); subsequent
     * rows are the named envelopes in their wire order:
     * `Meta rules`, `Host environment`, `Workspace context`,
     * `Session context`, `Run state`, `Prior conversations`,
     * `Recent memory`. Missing envelopes are silently skipped (an
     * idle snapshot before iter-0 hasn't built `<run_state>` yet, so
     * that row would be absent).
     *
     * The sum of `tokens` across rows is APPROXIMATELY equal to
     * `systemPromptTokens`. Small drift is expected (a few tokens
     * per envelope) because the renderer tokenises each row
     * independently — the chat-format framing tokens
     * `tokenizeMessages` adds for the system message's role marker
     * land in `systemPromptTokens` only. The Inspector pins the
     * lumped row to `systemPromptTokens` and only uses this field
     * for the indented sub-rows; the user-visible totals stay
     * authoritative.
     *
     * Optional so legacy callers / serialized snapshots from older
     * builds remain backward-compatible: when undefined, the
     * Inspector falls back to a non-foldable single row.
     */
    envelopes?: Array<{
      /** User-facing row title (e.g. `"Host environment"`). */
      label: string;
      /** Tokenized count of the envelope body. Zero is valid (an
       *  empty `<recent_memory>(no persistent notes matched)
       *  </recent_memory>` envelope still tokenizes to a handful of
       *  tokens, but a placeholder body could degenerate to 0). */
      tokens: number;
    }>;
  };
}

/**
 * Reduced view of `ContextSummaryRules` carried inside the
 * `context-summary-pending` TimelineEvent. The full rules object is
 * NOT persisted on every summary — we keep only the fields that
 * meaningfully affect replay or surfacing (the model used, the
 * trigger reason, the dropped-marker style at the time of the
 * summary). Sufficient for the renderer's "Show summarization
 * settings" expander.
 */
export interface PersistedSummaryConfig {
  summarizerSelection: ModelSelection;
  trigger: 'auto' | 'manual';
  droppedMarkerStyle: DroppedMarkerStyle;
}

/**
 * Default-rules collapse helper exposed to both sides so the
 * inspector + settings panel and the main-side resolver agree on
 * precedence. Pure; no I/O.
 *
 * Layering rules:
 *   1. Start from `DEFAULT_CONTEXT_SUMMARY_RULES`.
 *   2. Spread the global `partial` (`AppSettings.contextSummary`).
 *   3. Spread the workspace `partial`
 *      (`AppSettings.ui.contextSummaryByWorkspace[wsId]`).
 *
 * `perKindPolicy` is deep-merged so a workspace overriding only
 * `'tool-result': 'drop'` doesn't wipe out the global decisions
 * for other kinds.
 *
 * `summarizerSelection` is replace-by-layer: an explicit `null` at
 * the workspace level means "use the run's model" even if the
 * global pinned a specific model. To inherit the global selection
 * from a workspace, simply omit the field from the workspace
 * patch.
 */
export function resolveContextSummaryRules(
  global: Partial<ContextSummaryRules> | undefined,
  workspace: Partial<ContextSummaryRules> | undefined
): ContextSummaryRules {
  const base = DEFAULT_CONTEXT_SUMMARY_RULES;
  const g = global ?? {};
  const w = workspace ?? {};
  return {
    enabled: w.enabled ?? g.enabled ?? base.enabled,
    autoTriggerRatio: clamp01(
      w.autoTriggerRatio ?? g.autoTriggerRatio ?? base.autoTriggerRatio
    ),
    keepRecentTurns: Math.max(
      0,
      w.keepRecentTurns ?? g.keepRecentTurns ?? base.keepRecentTurns
    ),
    preserveUserPromptsAlways:
      w.preserveUserPromptsAlways ??
      g.preserveUserPromptsAlways ??
      base.preserveUserPromptsAlways,
    preserveFirstSystem:
      w.preserveFirstSystem ??
      g.preserveFirstSystem ??
      base.preserveFirstSystem,
    minMessagesToSummarize: Math.max(
      1,
      w.minMessagesToSummarize ??
      g.minMessagesToSummarize ??
      base.minMessagesToSummarize
    ),
    maxRetries: Math.max(
      0,
      w.maxRetries ?? g.maxRetries ?? base.maxRetries
    ),
    summarizerSelection:
      // `null` is a meaningful value (= use run's model) so we cannot
      // use `??` here — we want the deepest layer that explicitly set
      // the field to win, with `undefined` meaning "inherit".
      'summarizerSelection' in w
        ? w.summarizerSelection ?? null
        : 'summarizerSelection' in g
          ? g.summarizerSelection ?? null
          : base.summarizerSelection,
    perKindPolicy: {
      ...base.perKindPolicy,
      ...(g.perKindPolicy ?? {}),
      ...(w.perKindPolicy ?? {})
    },
    droppedMarkerStyle:
      w.droppedMarkerStyle ??
      g.droppedMarkerStyle ??
      base.droppedMarkerStyle
  };
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_CONTEXT_SUMMARY_RULES.autoTriggerRatio;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}
