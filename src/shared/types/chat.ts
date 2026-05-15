/**
 * Chat / orchestrator types. These flow through IPC and Zustand stores.
 */

import type { ToolCall, ToolResult, DiffHunk } from './tool.js';
import type { ModelSelection } from './provider.js';
import type { CheckpointChangeKind } from './checkpoint.js';

/**
 * Internal role union for `ChatMessage`. Not exported because the only
 * consumers outside this file are the OpenAI-compat wire layer (which
 * uses the literal strings inline) and tests (which import
 * `ChatMessage` directly). Audit §4: was previously exported but never
 * referenced externally.
 */
type ChatRole = 'system' | 'user' | 'assistant' | 'tool';

/**
 * Token usage reported by the provider at the end of a streamed turn.
 * Universal across OpenAI-compat providers when `stream_options.include_usage`
 * is set (final SSE chunk carries `usage: { prompt_tokens, completion_tokens,
 * total_tokens }`). Field names are normalized to camelCase at the stream
 * boundary so renderer code never sees snake_case.
 */
export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface ChatMessage {
  role: ChatRole;
  /**
   * Message content. May be `null` for assistant turns that emit only
   * `tool_calls` — that is the canonical OpenAI shape and several strict
   * providers (e.g. some Together / Groq routes) reject `""` paired with
   * `tool_calls`.
   */
  content: string | null;
  /** OpenAI-compat tool_calls (assistant messages may include them). */
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
  /** For role:'tool' messages, the id of the call being answered. */
  tool_call_id?: string;
  /** Optional name for tool messages (function name). */
  name?: string;
  /**
   * DeepSeek-style "thinking mode" chain-of-thought. Some providers (e.g.
   * DeepSeek V3.1+ thinking, deepseek-reasoner) require the previous turn's
   * reasoning_content to be echoed back on the next request. We capture it
   * during streaming and pass it through. Other providers ignore unknown
   * fields, so this is a safe additive.
   */
  reasoning_content?: string;
}

/**
 * A timeline entry rendered in the renderer. The orchestrator emits these as
 * a side-channel event stream so the UI can render the swarming process
 * transparently — it is NOT the message array sent to the model.
 */
export type TimelineEvent =
  /**
   * The user's prompt, emitted at the very top of every orchestrator
   * run. Carries the originating `runId` so the inline per-prompt
   * Revert affordance can resolve the matching checkpoint manifest in
   * O(1) instead of the older `(conversationId, startedAt)` heuristic.
   *
   * Older transcripts persisted before this field was added still
   * deserialise (the field is optional on the wire); rewind / preview
   * code paths fall back to a `manifest.startedAt ≈ event.ts` match
   * when `runId` is absent.
   */
  | { kind: 'user-prompt'; id: string; ts: number; content: string; runId?: string }
  | {
    kind: 'agent-thought';
    id: string;
    ts: number;
    content: string;
    /**
     * Visual severity hint for the renderer. Defaults to `'info'` when
     * omitted (silent muted text — the original behavior). `'warn'` is
     * emitted for retry / self-correction notices so they don't blend in
     * with idle "thinking…" lines. The host must NEVER use this to
     * surface privileged content; the field is purely cosmetic.
     */
    severity?: 'info' | 'warn';
  }
  /**
   * Streaming assistant text. The optional `subagentId` slot lets the
   * orchestrator-owned event stream carry sub-agent worker text and
   * reasoning DURING delegation, so the matching `SubAgentTrace`
   * card can surface live worker output instead of going dark until
   * the worker emits its `<result>` envelope. Audit fix §1.1.
   *
   * - When `subagentId` is omitted, the event belongs to the
   *   orchestrator's own assistant turn (legacy shape — every
   *   pre-§1.1 event lacked the slot, so back-compat is automatic).
   * - When set, `id` is a per-iteration `assistantMsgId` minted by
   *   the sub-agent's stream consumer; consumers must NOT assume
   *   uniqueness across sub-agents — pair `id` with `subagentId`
   *   when keying state.
   */
  | { kind: 'agent-text-delta'; id: string; ts: number; delta: string; subagentId?: string }
  | { kind: 'agent-text-end'; id: string; ts: number; subagentId?: string }
  /** Drop the partial in-flight assistant text (mid-stream error → retry). */
  | { kind: 'agent-text-aborted'; id: string; ts: number; subagentId?: string }
  /** Streaming chain-of-thought (DeepSeek-style). UI shows a collapsible card. */
  | { kind: 'agent-reasoning-delta'; id: string; ts: number; delta: string; subagentId?: string }
  | { kind: 'agent-reasoning-end'; id: string; ts: number; subagentId?: string }
  | { kind: 'phase'; id: string; ts: number; label: string }
  /**
   * Mid-stream notice that the orchestrator has just emitted a fully-formed
   * `<delegate ... />` directive in the current assistant turn. Allows the
   * UI to surface the pending sub-agent as a row before the orchestrator
   * turn even ends and the pool actually spawns. Carries the directive's
   * own `id` attribute so the matching `subagent-spawn` can dedup and
   * transition the row from `pending` → `running` cleanly.
   */
  | {
    kind: 'subagent-pending';
    id: string;
    ts: number;
    subagentId: string;
    task: string;
    files: string[];
    tools: string[];
  }
  | {
    kind: 'subagent-spawn';
    id: string;
    ts: number;
    subagentId: string;
    task: string;
    files: string[];
    /**
     * Tools granted to this worker by the `<delegate tools="…" />` directive,
     * resolved through `validateSubagentToolset` (`read,ls,search` default
     * when the directive omits the attribute).
     *
     * Emitted on spawn so the renderer can populate the sub-agent's tools
     * chip row from a single authoritative source. A preceding
     * `subagent-pending` event may carry its own `tools` list parsed from
     * the directive mid-stream; the reducer prefers the spawn's value when
     * non-empty but falls back to the pending list otherwise so the UI is
     * robust whether or not pending ran first.
     */
    tools: string[];
    /**
     * Paths the orchestrator's pre-spawn validator could not resolve
     * against the workspace FS — typically model-invented paths like
     * `core/agent.py` in a TypeScript repo (see screenshot §1). These
     * are NOT fed to the worker's `inlineFiles` (the `files` array
     * above already excludes them); they're carried separately so the
     * renderer can mark them as "not found" chips alongside the
     * resolvable ones. Omitted on the wire when every path resolved.
     */
    missingFiles?: string[];
  }
  | {
    kind: 'subagent-status';
    id: string;
    ts: number;
    subagentId: string;
    status: 'done' | 'failed' | 'aborted';
    message?: string;
  }
  | {
    kind: 'subagent-result';
    id: string;
    ts: number;
    subagentId: string;
    output: string;
  }
  | { kind: 'tool-call'; id: string; ts: number; call: ToolCall; subagentId?: string }
  | { kind: 'tool-result'; id: string; ts: number; result: ToolResult; subagentId?: string }
  /**
   * Live partial-args snapshot for a streaming tool call. Emitted by
   * `consumeChatStream` every time the provider delivers a new
   * `argumentsDelta` fragment, BEFORE the matching `tool-call` event
   * (which carries the final, fully-parsed `args` object) lands.
   *
   * Carries the cumulative `argsBuf` (not the per-frame delta) so the
   * renderer is robust to dropped IPC frames — the latest event always
   * supersedes earlier ones for the same `callId`. The renderer feeds
   * the buffer through a stateful `PartialJsonParser` to turn the
   * partial JSON into a best-effort `Record<string, unknown>` and
   * paints a streaming preview (e.g. a live partial diff for `edit`,
   * a live path label for `read`/`ls`, a live query for `search`).
   *
   * Surrogate callIds: when the provider has not yet sent a real id
   * for the call (first delta of a stream), the orchestrator uses
   * `pending:${subagentId ?? 'orc'}:${index}` so the renderer can
   * coalesce by index until the real id arrives in the eventual
   * `tool-call` event.
   *
   * IMPORTANT: this event is intentionally NOT persisted to the JSONL
   * transcript (see `isPersistentEvent` in `chat.ipc.ts`). The final
   * `tool-call` event captures the authoritative parsed args; the
   * deltas are pure live telemetry, meaningless on replay.
   */
  | {
    kind: 'tool-call-args-delta';
    id: string;
    ts: number;
    /** Stable per-call key (real id, or `pending:${subagentId ?? 'orc'}:${index}` surrogate). */
    callId: string;
    /** Tool name as soon as the provider names it (may arrive on the first frame). */
    name?: string;
    /** Provider-reported per-call index inside the assistant turn. */
    index: number;
    /** Cumulative argumentsBuf snapshot — latest wins per `callId`. */
    argsBuf: string;
    subagentId?: string;
  }
  /**
   * FS-aware live diff for an in-flight tool call. Phase 2 of the
   * streaming-diffs plan. Emitted by the main-process diff streamer
   * (`src/main/orchestrator/diffStreamer.ts`) when a streaming
   * `edit` / `delete` / detected `bash`-write call has had its
   * target file body read AND the streaming `oldString` / `newString`
   * (or detected write content) parses to enough structure to
   * synthesise an updated body.
   *
   * The renderer paints these hunks instead of the renderer-side
   * `synthesizeDiffPreview` output when present, because they are
   * computed against the actual on-disk file body — line numbers
   * are real, surrounding context lines are real, and the diff
   * matches exactly what the authoritative `tool-result.data.hunks`
   * will land with once the tool runs.
   *
   * Cumulative semantics: each event for a given `callId` SUPERSEDES
   * the previous one (latest wins). Renderer drops the entry when
   * the matching `tool-call` lands or the run terminates.
   *
   * IMPORTANT: this event is intentionally NOT persisted to the JSONL
   * transcript (see `isPersistentEvent` in `chat.ipc.ts`). On replay,
   * the authoritative `tool-result` carries the final hunks; the
   * streaming diffs are pure live telemetry.
   */
  | {
    kind: 'diff-stream';
    id: string;
    ts: number;
    /** Same key family as `tool-call-args-delta`. */
    callId: string;
    /** Source tool — `edit`, `delete`, or the synthetic `'bash'`. */
    tool: 'edit' | 'delete' | 'bash';
    /** Workspace-relative path the diff is against. */
    filePath: string;
    /** Cumulative hunk array, latest-wins per callId. */
    hunks: DiffHunk[];
    /** Sum of `+` lines across hunks. Cached so the renderer doesn't re-walk. */
    additions: number;
    /** Sum of `-` lines across hunks. Cached so the renderer doesn't re-walk. */
    deletions: number;
    /**
     * `true` once the authoritative `tool-call` has landed for this
     * `callId`; the renderer flips to settled styling but keeps the
     * same hunks visible until the matching `tool-result` arrives.
     * Optional because the event is also useful pre-settle.
     */
    settled?: boolean;
    subagentId?: string;
  }
  | {
    kind: 'file-edit';
    id: string;
    ts: number;
    /**
     * Originating orchestrator run id. Carries the parent run for both
     * orchestrator-level and sub-agent-level edits (sub-agents inherit
     * the parent run's id) so the renderer can aggregate per-turn FS
     * impact in O(1) for the inline Revert badge on `UserPromptRow`.
     *
     * Optional on the wire so older transcripts persisted before this
     * field was added still deserialise — the badge simply renders no
     * count for those legacy turns; rewind/preview heuristics still
     * resolve the manifest via `(conversationId, startedAt ≈ promptTs)`.
     */
    runId?: string;
    filePath: string;
    additions: number;
    deletions: number;
    subagentId?: string;
  }
  /**
   * Token-usage report for a single streamed assistant turn. Emitted by the
   * orchestrator turn (`subagentId` omitted) and by each sub-agent iteration
   * (`subagentId` set).
   *
   * `assistantMsgId` is the id of the matching orchestrator turn; consumers
   * join the event to the turn's text/reasoning deltas via this slot. For
   * sub-agent emissions the field is intentionally an EMPTY STRING (sub-
   * agent iterations don't produce orchestrator-level assistant turns) — the
   * stable handle used for grouping is the `subagentId` field, NOT
   * `assistantMsgId`. The optional `subagentTurnId` carries an id for the
   * specific sub-agent iteration when one is available, but the renderer
   * aggregates only on `subagentId`.
   */
  | {
    kind: 'token-usage';
    id: string;
    ts: number;
    assistantMsgId: string;
    usage: TokenUsage;
    subagentId?: string;
    subagentTurnId?: string;
  }
  /**
   * Live orchestrator telemetry for the "waiting" window between streaming
   * deltas. Emitted at every meaningful transition (connecting, awaiting
   * first token, running a tool, preparing the next turn, delegating,
   * verifying sub-agent output, nudging, retrying after a provider
   * failure). The renderer surfaces the most recent one in a single
   * live status row plus a stopwatch since it was emitted.
   *
   * IMPORTANT: run-status is pure live telemetry — it is intentionally
   * NOT persisted to the JSONL transcript (see `isPersistentEvent` in
   * `chat.ipc.ts`). Replay reconstructs the semantic timeline from the
   * other event kinds; the progress stream has no meaning after the fact.
   */
  | {
    kind: 'run-status';
    id: string;
    ts: number;
    phase:
    | 'connecting'
    | 'awaiting-response'
    | 'running-tool'
    | 'preparing-turn'
    | 'delegating'
    | 'verifying'
    | 'nudging'
    | 'retrying'
    /**
     * Pre-iteration context-budget shrink fired. Audit fix §2.3 — the
     * orchestrator estimates the request's token count against the
     * model's effective context window and trims oldest sub-agent
     * envelopes / tool rounds before issuing the request. Only emitted
     * when the trimmer ACTUALLY removed something so the live status
     * row never flashes a no-op label. The detail's `trimmedMessages`
     * + `targetTokens` slots let the UI surface "trimmed N old turns
     * to fit Mk window".
     */
    | 'trimming';
    /** Short human-readable label the row shows by default. */
    label: string;
    /** Optional structured context for richer rendering. */
    detail?: {
      toolName?: string;
      attempt?: number;
      maxAttempts?: number;
      delegates?: number;
      subagentId?: string;
      providerId?: string;
      modelId?: string;
      iteration?: number;
      /**
       * Audit fix §2.3 — number of `ChatMessage` rows the trimmer
       * removed on this `trimming` event. Lets the live row read
       * "trimmed 4 old turns to fit 128k window" instead of a vague
       * shrinking pill.
       */
      trimmedMessages?: number;
      /**
       * Audit fix §2.3 — the token target the trimmer was aiming for
       * (typically `0.85 * effectiveContextWindow`). Combined with the
       * `tokensBefore` / `tokensAfter` snapshots in `label`, this gives
       * triage a single-row view of why the trim fired.
       */
      targetTokens?: number;
      /** Audit fix §2.3 — pre-trim estimate. */
      tokensBefore?: number;
      /** Audit fix §2.3 — post-trim estimate. */
      tokensAfter?: number;
    };
  }
  | { kind: 'error'; id: string; ts: number; message: string }
  /**
   * Audit fix §2.2 — transcript-aware summarization sentinel. Emitted
   * by the run-loop when (a) the user has opted into summarization
   * via `AppSettings.historySummary.enabled`, (b) the per-turn trim
   * policy (§2.3) couldn't get the request under budget, and (c) the
   * one-shot summarizer LLM call returned a usable body.
   *
   * The event is **persistent** (lands in JSONL) so transcript replay
   * reconstructs the same compacted view the live run saw. On replay
   * (`replayTranscript.ts`):
   *
   *   1. The summary body is injected as a synthetic
   *      `<history_summary>…</history_summary>` user message at the
   *      original event's position in the stream.
   *   2. Every `replacedEventIds` is masked out — those original
   *      events DO still live on disk for audit/debug purposes, but
   *      are NOT folded into the orchestrator's reconstructed
   *      `messages[]`. The model sees the summary, not the raw
   *      history.
   *
   * The renderer reducer treats this as event-list-only churn (no
   * dedicated row) — the user already saw the live timeline; once
   * the summary collapses old turns, those rows stay rendered for
   * the current session and only get masked on transcript reload.
   */
  | {
    kind: 'history-summary';
    id: string;
    ts: number;
    /**
     * Markdown body produced by the summarizer LLM call. Wrapped in
     * `<history_summary>…</history_summary>` on the wire so the
     * orchestrator can recognize / re-cite it.
     */
    summary: string;
    /**
     * Event ids whose model-visible projection this summary replaces.
     * Replay skips them when reconstructing `messages[]` so the
     * orchestrator's view stays compact. Stable event ids — the same
     * ids the renderer already uses to index the timeline.
     */
    replacedEventIds: string[];
    /** Provider used for the summarizer call. Audit trail. */
    providerId?: string;
    /** Model used for the summarizer call. Audit trail. */
    modelId?: string;
  }
  /**
   * A checkpoint entry was recorded — the `edit` or new `delete` tool
   * snapshotted a file's pre-state into the blob store. Persistent;
   * replayed so transcript reloads still surface the entry in the
   * timeline and the pending-changes registry can rebuild on boot
   * via `chat.ipc.ts`'s replay seed.
   *
   * The renderer reducer DOES NOT mutate any visual rows on this
   * event; the existing `tool-result` / `file-edit` pair already
   * paints the diff. This event exists so:
   *   1. The renderer's `useCheckpointsStore` learns about the
   *      pending entry without a separate IPC round-trip.
   *   2. Replay reconstructs the same pending registry the live run
   *      had — so a renderer reload mid-run doesn't lose the
   *      Accept/Reject affordance.
   */
  | {
    kind: 'checkpoint-entry';
    id: string;
    ts: number;
    entryId: string;
    runId: string;
    conversationId: string;
    workspaceId: string;
    filePath: string;
    changeKind: CheckpointChangeKind;
    preHash?: string;
    postHash?: string;
    additions: number;
    deletions: number;
    /**
     * Which tool produced this entry. Mirrors
     * `CheckpointEntry.source` — see that type for the semantics of
     * each variant.
     */
    source: 'edit' | 'delete' | 'bash';
    subagentId?: string;
  }
  /**
   * A previously-recorded checkpoint entry has been reverted (the
   * user clicked Reject in the pending panel, or chose Revert in
   * the Checkpoints view). Persistent — surfaces in the timeline
   * as an audit row and lets transcript replay flip the entry's
   * `reverted` flag on the in-memory registry without re-reading
   * the run manifest.
   */
  | {
    kind: 'checkpoint-revert';
    id: string;
    ts: number;
    entryId: string;
    /**
     * Run id the original `checkpoint-entry` was recorded under, when
     * known. Optional because user-initiated reverts from the
     * Checkpoints view (`revertFileToHash`) don't carry a conversation
     * context and therefore have no run to attribute the revert to.
     * The previous shape required this field and call sites emitted
     * an empty string — a typing lie the renderer accidentally
     * tolerated. Review finding H5.
     */
    runId?: string;
    filePath: string;
    /** `'restore'` for modify/delete revert, `'remove'` for create revert. */
    operation: 'restore' | 'remove';
  }
  /**
   * `bash` detected a file-system mutation it could not snapshot
   * (the agent ran `rm`, `mv`, `> file`, etc.). Carries the list of
   * workspace-relative paths whose mtime / existence changed. The
   * renderer surfaces this as a warning row so the user knows the
   * change is NOT revertable through the checkpoint store.
   */
  | {
    kind: 'checkpoint-bash-mutation';
    id: string;
    ts: number;
    /** The command that mutated files. */
    command: string;
    /** Workspace-relative paths that were created/modified/deleted. */
    paths: string[];
    subagentId?: string;
  };

/** Sent from renderer to main to start an agent run. */
export interface ChatSendInput {
  /** Stable id assigned by the renderer; used for delta + abort routing. */
  runId: string;
  /** User text. */
  prompt: string;
  /** Selected model (provider + model id). */
  selection: ModelSelection;
  /** Whether destructive ops are pre-approved for this run. */
  permissions: ChatPermissions;
  /**
   * The conversation this run belongs to. If omitted, the main process will
   * auto-create one and return its id via the `chat:send` reply.
   */
  conversationId?: string;
  /**
   * Workspace this run is sandboxed to. Optional on the wire — when
   * absent, main resolves it from the conversation's `workspaceId`. The
   * renderer always supplies it on auto-create paths so a fresh
   * conversation lands under the right workspace. Once resolved, the
   * orchestrator pins it for the entire run, so a mid-run change of
   * the globally active workspace can never affect this run's sandbox.
   */
  workspaceId?: string;
  /** Workspace-relative file paths attached by the user. Optional. */
  attachments?: string[];
}

/**
 * Reply shape from `chat:send`.
 *
 *   - Happy path: `{ ok: true, conversationId }`.
 *   - `pending-checkpoints`: the run's workspace has
 *     `gatePromptOnPendingByWorkspace` set AND the conversation has
 *     unresolved pending checkpoint entries. The renderer surfaces a
 *     toast and opens the pending panel; no run is started.
 *
 * Extending the union keeps the happy-path shape unchanged (legacy
 * renderers still assert `reply.ok === true`), but a future `ok: false`
 * variant is already wired.
 */
export type ChatSendReply =
  | { ok: true; conversationId: string }
  | {
    ok: false;
    /** Discriminant for the refused-to-start path. */
    kind: 'pending-checkpoints';
    /** How many pending entries are blocking the send. */
    count: number;
    /** Conversation the block applies to (echo of the input). */
    conversationId: string;
  };

export interface ChatPermissions {
  /** Allow edits / writes without per-edit confirmation. */
  allowFileWrites: boolean;
  /** Allow bash / shell commands. */
  allowBash: boolean;
  /** Allow web search. */
  allowWebSearch: boolean;
}

/** Compact metadata for the sidebar history list (loaded eagerly). */
export interface ConversationMeta {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  /** Number of events on disk. Useful for "Load earlier…" affordances. */
  eventCount: number;
  /** Last model selection used (best-effort; for resuming with the same model). */
  lastModelId?: string;
  lastProviderId?: string;
  /**
   * Id of the workspace this conversation belongs to. Optional on the
   * wire for backward compatibility with pre-multi-workspace
   * `index.json` blobs, but the conversation store's `loadIndex()`
   * migration stamps every meta with the legacy/active workspace id on
   * first boot, so renderer code can treat this as effectively required
   * after the first `conversations.list()` resolves.
   */
  workspaceId?: string;
}

/** Full transcript shape (events streamed from disk). */
export interface Conversation extends ConversationMeta {
  events: TimelineEvent[];
}
