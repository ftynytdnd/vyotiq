/**
 * Chat / orchestrator types. These flow through IPC and Zustand stores.
 */

import type { ToolCall, ToolResult, DiffHunk } from './tool.js';
import type { ModelSelection, ThinkingEffort } from './provider.js';
import type { CheckpointChangeKind } from './checkpoint.js';
import type { AskUserStructuredPayload } from './askUser.js';
import type { MentionRef } from './mention.js';

/**
 * Internal role union for `ChatMessage`. Not exported because the only
 * consumers outside this file are the OpenAI-compat wire layer (which
 * uses the literal strings inline) and tests (which import
 * `ChatMessage` directly). Audit §4: was previously exported but never
 * referenced externally.
 */
type ChatRole = 'system' | 'user' | 'assistant' | 'tool';

/**
 * Token usage reported by the provider for a streamed turn. Universal across
 * OpenAI-compat providers when `stream_options.include_usage` is set; native
 * Anthropic and Gemini dialects map their richer 2026 wire shapes into the
 * same fields. Field names are normalized to camelCase at the stream
 * boundary so renderer code never sees snake_case.
 *
 * The optional `reasoning*` / `cached*` fields are SUBSETS of the
 * containing primary field (already counted there) — surfaced separately
 * so the UI can break down where the tokens went. NEVER sum them on top
 * of the primary number.
 *
 *   - `reasoningTokens` is a subset of `completionTokens`.
 *   - `cachedPromptTokens` is a subset of `promptTokens`.
 *   - `cacheCreationTokens` is a subset of `promptTokens` (Anthropic-only;
 *     bytes WRITTEN to the prompt cache this turn — separate billing
 *     line from cache reads).
 *
 * 2026 dialect mapping (verified against the cited docs in the plan):
 *
 *   - OpenAI Chat Completions:
 *       reasoningTokens     = usage.completion_tokens_details.reasoning_tokens
 *       cachedPromptTokens  = usage.prompt_tokens_details.cached_tokens
 *
 *   - DeepSeek V4 (OpenAI-compat with non-standard cache field names):
 *       reasoningTokens     = usage.completion_tokens_details.reasoning_tokens
 *       cachedPromptTokens  = usage.prompt_cache_hit_tokens
 *
 *   - xAI Grok 4.x (OpenAI-compat):
 *       reasoningTokens     = usage.completion_tokens_details.reasoning_tokens
 *       cachedPromptTokens  = usage.prompt_tokens_details.cached_tokens
 *
 *   - Anthropic native:
 *       cachedPromptTokens  = message_{start,delta}.usage.cache_read_input_tokens   (CUMULATIVE — replace, never add)
 *       cacheCreationTokens = message_{start,delta}.usage.cache_creation_input_tokens (CUMULATIVE — replace, never add)
 *
 *   - Gemini native:
 *       reasoningTokens     = usageMetadata.thoughtsTokenCount
 *       cachedPromptTokens  = usageMetadata.cachedContentTokenCount
 *
 *   - Ollama native:
 *       no cache / no reasoning breakdown on the wire today
 */
export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  /** Subset of `completionTokens` spent on reasoning / thinking. */
  reasoningTokens?: number;
  /** Subset of `promptTokens` served from the prompt cache. */
  cachedPromptTokens?: number;
  /** Anthropic-only: subset of `promptTokens` WRITTEN to the prompt cache
   *  this turn. Surfaced separately so users can spot wasted cache writes
   *  (a write with no subsequent read is a billing footgun on Sonnet
   *  4.6+). */
  cacheCreationTokens?: number;
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
    /**
     * Phase 9 (2026) — Gemini-only: opaque thoughtSignature that
     * Gemini 3.x emits alongside a `functionCall` part. The
     * orchestrator persists it here on the assistant message so
     * the next request echoes the same signature back on the
     * matching `functionCall`. Gemini's API returns 400
     * "Function call signature missing or invalid" without it on
     * the "Current Turn" of a multi-call sequence. Source:
     *   https://ai.google.dev/gemini-api/docs/thought-signatures
     *
     * Other dialects ignore this field (it's stripped before any
     * non-Gemini wire serialization). Persisted on the JSONL
     * transcript via the `tool-call.thoughtSignature` field so a
     * renderer reload + replay reconstructs it faithfully.
     */
    thoughtSignature?: string;
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
  /**
   * Anthropic-only: opaque encrypted signature that finalizes a `thinking`
   * content block. Captured from the `signature_delta` SSE event during
   * streaming and round-tripped UNCHANGED on the next request — Claude
   * thinking models lose their reasoning chain across turns when the
   * signature is missing or modified. Source:
   * https://platform.claude.com/docs/en/docs/build-with-claude/extended-thinking
   *
   * Only populated by the `anthropic-native` transport. Other dialects
   * (DeepSeek thinking, Ollama thinking, OpenAI o-series) don't surface a
   * sibling signature on the wire — their reasoning text alone is the
   * round-trip contract.
   *
   * Persisted on the JSONL transcript via the `agent-reasoning-end` event's
   * `signature` field so a renderer reload + replay reconstructs it
   * faithfully. The Anthropic Messages API auto-filters thinking blocks
   * from prior turns it doesn't need (per-model class — see Anthropic's
   * "Thinking block preservation by model" docs), so a missing signature
   * for an older model class is harmless; for Opus 4.5+/Sonnet 4.6+ the
   * API keeps prior thinking blocks and the signature MUST round-trip.
   */
  reasoning_signature?: string;
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
  | {
    kind: 'user-prompt';
    id: string;
    ts: number;
    content: string;
    runId?: string;
    /** Persisted attachment metadata for timeline cards after reload. */
    attachments?: PromptAttachmentMeta[];
    /** Inline `@` file mentions (chips), resolved into context on send. */
    mentions?: MentionRef[];
  }
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
  | { kind: 'agent-text-delta'; id: string; ts: number; delta: string }
  | { kind: 'agent-text-end'; id: string; ts: number }
  /** Drop the partial in-flight assistant text (mid-stream error → retry). */
  | { kind: 'agent-text-aborted'; id: string; ts: number }
  /** Streaming chain-of-thought (DeepSeek-style). UI shows a collapsible card. */
  | {
      kind: 'agent-reasoning-delta';
      id: string;
      ts: number;
      delta: string;
      /** Set on the first reasoning delta of a turn for the effort badge. */
      effort?: ThinkingEffort;
    }
  /**
   * Closes a streaming reasoning panel. The optional `signature` field
   * carries the Anthropic `signature_delta` payload concatenated across
   * the closing thinking block — it MUST be passed back unchanged on the
   * next request for thinking-capable Claude models, otherwise the model
   * loses its reasoning chain (returns a degraded response or, on Gemini
   * 3 function calling, a 400 error). Optional on the wire so older
   * persisted transcripts and non-Anthropic dialects still deserialise
   * cleanly. The replay layer fans the signature back onto the matching
   * assistant `ChatMessage.reasoning_signature` slot.
   */
  | { kind: 'agent-reasoning-end'; id: string; ts: number; signature?: string }
  /**
   * Phase divider row. `label` is user-facing and MUST be free of literal
   * harness XML. `tooltip`, when present,
   * carries the developer-facing detail (technical contract, raw ids,
   * full reason) and is surfaced via the divider's `title` attribute.
   * Both fields persist in the JSONL transcript so historical replays
   * keep the same tooltip surface.
   */
  | { kind: 'phase'; id: string; ts: number; label: string; tooltip?: string }
  /**
   * Structured clarifying question from `ask_user` (multi-choice). Persisted
   * for timeline replay; plain-text fallback uses `agent-text-delta` when
   * only legacy `question` is present.
   */
  | {
    kind: 'ask-user-prompt';
    id: string;
    ts: number;
    displayText: string;
    payload: AskUserStructuredPayload;
    toolCallId: string;
    runId: string;
    status?: 'pending' | 'submitted';
    /** Distinguishes host-injected gates from agent clarifications. */
    source?: 'host-report-gate';
  }
  /** Marks an interactive ask_user prompt as answered (UI latch). */
  | {
    kind: 'ask-user-submitted';
    id: string;
    ts: number;
    promptEventId: string;
    toolCallId: string;
    runId: string;
  }
  | { kind: 'tool-call'; id: string; ts: number; call: ToolCall }
  | { kind: 'tool-result'; id: string; ts: number; result: ToolResult }
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
   * `pending:orc:${index}` so the renderer can
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
    /** Stable per-call key (real id, or `pending:orc:${index}` surrogate). */
    callId: string;
    /** Tool name as soon as the provider names it (may arrive on the first frame). */
    name?: string;
    /** Provider-reported per-call index inside the assistant turn. */
    index: number;
    /** Cumulative argumentsBuf snapshot — latest wins per `callId`. */
    argsBuf: string;
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
    /** Source tool — `edit`, `delete`, `bash`, or `report`. */
    tool: 'edit' | 'delete' | 'bash' | 'report';
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
  }
  | {
    kind: 'file-edit';
    id: string;
    ts: number;
    /**
     * Originating run id so the renderer can aggregate per-turn FS
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
    /** Links this row to a checkpoint pending entry for inline Accept/Reject. */
    entryId?: string;
  }
  /**
   * Token-usage report for a single streamed assistant turn.
   * `assistantMsgId` joins the event to the turn's text/reasoning deltas.
   */
  | {
    kind: 'token-usage';
    id: string;
    ts: number;
    assistantMsgId: string;
    usage: TokenUsage;
  }
  /**
   * Live orchestrator telemetry for the "waiting" window between streaming
   * deltas. Emitted at every meaningful transition (connecting, awaiting
   * first token, running a tool, preparing the next turn, nudging,
   * retrying after a provider
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
    | 'nudging'
    | 'retrying';
    /** Short human-readable label the row shows by default. */
    label: string;
    /** Optional structured context for richer rendering. */
    detail?: {
      toolName?: string;
      attempt?: number;
      maxAttempts?: number;
      providerId?: string;
      modelId?: string;
      iteration?: number;
      /** Resolved API host for the active provider (composer status). */
      endpointHost?: string;
    };
  }
  | { kind: 'error'; id: string; ts: number; message: string }
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
  }
  /**
   * A previously-recorded checkpoint entry has been reverted (the
   * user clicked Reject in the timeline pending row, or reverted via
   * checkpoints IPC). Persistent — surfaces in the timeline
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
     * file-hash revert (`revertFileToHash`) don't carry a conversation
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
  }
  /**
   * Synthetic mid-stream usage update (Phase 3 — 2026). Emitted
   * locally by `chatChannel` as `agent-text-delta` /
   * `agent-reasoning-delta` events stream in, so the composer pill
   * and composer token pill can show a growing token count BEFORE the
   * provider's authoritative `usage` frame lands at end-of-turn.
   *
   * The reducer sets these onto `TokenUsageAggregate.inFlight` and
   * leaves `latest` untouched; the authoritative `token-usage` event
   * always wins on arrival and clears the slot.
   *
   * IMPORTANT: NOT persisted to JSONL (added to `isPersistentEvent`
   * deny list alongside `tool-call-args-delta` and `run-status`).
   * On replay the authoritative `token-usage` events restore the
   * same final state, so the synthetic stream is pure live
   * telemetry — meaningless after the fact.
   *
   */
  | {
    kind: 'synthetic-usage-update';
    id: string;
    ts: number;
    /**
     * Total completion tokens estimated since the last authoritative
     * `token-usage` event. The reducer replaces `inFlight.completionTokens`
     * with this value (not adds — the renderer already accumulates
     * per delta and emits the running total each frame).
     */
    completionTokens: number;
  };

/** Phases for ephemeral `run-status` timeline events. */
export type RunStatusPhase = Extract<TimelineEvent, { kind: 'run-status' }>['phase'];

/** Attachment descriptor on user-prompt events and send wire. */
export interface PromptAttachmentMeta {
  id: string;
  name: string;
  mimeType?: string;
  sizeBytes?: number;
  /** Absolute path under app userData when copied from external drop. */
  storedPath?: string;
  /** Workspace-relative path when picked inside the project. */
  workspacePath?: string;
  external?: boolean;
}

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
  /** Rich attachment metadata from external ingest (preferred when present). */
  attachmentMeta?: PromptAttachmentMeta[];
  /**
   * Stable user-prompt event id from the composer. When set, external
   * attachment copies ingested under this id stay aligned with the
   * persisted `user-prompt` row after send.
   */
  promptEventId?: string;
  /** Inline `@` file mentions from the composer (not attachment pills). */
  mentions?: MentionRef[];
}

/**
 * Reply shape from `chat:send`.
 *
 *   - Happy path: `{ ok: true, conversationId }`.
 *   - `unknown-conversation`: bound id is not in the conversations index.
 */
export type ChatSendReply =
  | { ok: true; conversationId: string }
  | {
    ok: false;
    kind: 'unknown-conversation';
    /** Id the renderer sent that is not in the conversations index. */
    conversationId: string;
  };

export interface ChatPermissions {
  /** Reserved — no approval gating; mutating tools apply immediately. */
}

/** Compact metadata for the dock chat list (loaded eagerly). */
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
   * Highest observed orchestrator prompt-token count for this
   * conversation (persisted from `token-usage` events). Lets list /
   * dock surfaces show peak-context badges without hydrating the
   * full transcript slice.
   */
  peakPromptTokens?: number;
  /**
   * Id of the workspace this conversation belongs to. Optional on the
   * wire for backward compatibility with pre-multi-workspace
   * `index.json` blobs, but the conversation store's `loadIndex()`
   * migration stamps every meta with the legacy/active workspace id on
   * first boot, so renderer code can treat this as effectively required
   * after the first `conversations.list()` resolves.
   */
  workspaceId?: string;
  /** When set, conversation is hidden from the main dock list. */
  archived?: boolean;
  archivedAt?: number;
}

/** Full transcript shape (events streamed from disk). */
export interface Conversation extends ConversationMeta {
  events: TimelineEvent[];
}
