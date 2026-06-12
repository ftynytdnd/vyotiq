/**
 * Chat IPC. Bridge between the renderer and the orchestrator runtime.
 *
 * Responsibilities:
 *   - Bind every run to a conversation (auto-create if missing).
 *   - Mirror every TimelineEvent to the conversation's JSONL transcript.
 *   - Forward the same events to the renderer for live UI updates.
 *   - Derive a short title from the first user prompt.
 */

import { IPC, PERSIST_DELTA_COALESCE_CHARS } from '@shared/constants.js';
import type {
  ChatSendInput,
  ChatSendReply,
  TimelineEvent
} from '@shared/types/chat.js';
import {
  abortRun,
  findAllActiveRunsForConversation,
  findPausedRunForConversation,
  listActiveRuns,
  startRun,
  submitAskUserAnswers
} from '../orchestrator/AgentV.js';
import { safeWebContentsSend } from '../window/safeWebContentsSend.js';
import {
  appendEvent,
  createConversation,
  deriveTitleIfFresh,
  drainAppendChain,
  getConversationMeta,
  readTranscript,
  setLastModel
} from '../conversations/conversationStore.js';
import { getActiveWorkspace } from '../workspace/workspaceState.js';
import { logger } from '../logging/logger.js';
import { wrapIpcHandler } from './wrapIpcHandler.js';
import { assertString } from './validate.js';
import { assertChatSendInput } from './chatValidate.js';
import { assertAskUserSubmitInput } from './askUserValidate.js';
import {
  armRunSettlement,
  awaitRunSettlement,
  settleRun
} from './runSettlement.js';

const log = logger.child('ipc/chat');

/**
 * Per-assistant-turn buffer of streaming `agent-text-delta` /
 * `agent-reasoning-delta` text used by the persistence coalescer.
 *
 * Streaming chat-completion providers emit one SSE frame per token; a
 * 5 000-token response therefore generates ~5 000 individual delta
 * events. Persisting every one as its own JSONL row (the pre-coalescer
 * behavior) turned into an `fs.appendFile` storm that could saturate
 * the per-conversation write chain — visible to the user as the
 * orchestrator "getting stuck" mid-stream under OneDrive / cloud-
 * synced `userData`.
 *
 * The coalescer aggregates deltas for the same assistant turn and
 * flushes ONE consolidated event to disk when any of these triggers
 * fire:
 *   - buffered length reaches `PERSIST_DELTA_COALESCE_CHARS`
 *   - the matching `agent-text-end` / `agent-reasoning-end` arrives
 *   - an `agent-text-aborted` arrives (drops both text AND reasoning)
 *   - the run ends (done / error) — catch-all
 *
 * The reducer already sums deltas with identical `id`s during replay
 * (`applyTimelineEvent` accumulates into `assistantTexts[id]`), so a
 * single 200-char delta is functionally identical to 200 single-char
 * deltas. The renderer always receives every individual delta for
 * smooth token-by-token streaming — only the persisted shape changes.
 *
 * The same coalescer machinery handles assistant text/reasoning deltas.
 */
interface DeltaBuf {
  kind: 'agent-text-delta' | 'agent-reasoning-delta';
  /** Assistant message id carried on every delta (persisted event `id`). */
  id: string;
  /** Timestamp of the FIRST unflushed delta in this buffer. */
  ts: number;
  /** Accumulated delta text. */
  text: string;
}

interface CoalescerEntry {
  text?: DeltaBuf;
  reasoning?: DeltaBuf;
}

/**
 * Predicate that decides whether a TimelineEvent should be appended to
 * the conversation's JSONL transcript. Everything is persistent EXCEPT
 * `run-status` — that stream is pure live telemetry for the renderer's
 * `LiveStatusRow` and has no meaning on replay. Persisting it would
 * just bloat transcripts with transient phase flips ("connecting",
 * "awaiting-response", "running-tool:read", …) that already get their
 * authoritative counterparts (`tool-call`, `phase`, `agent-text-delta`,
 * etc.) on the same timeline.
 *
 * Kept as a small named helper rather than an inline check so the rule
 * lives in one place and any future non-persistent event kinds can be
 * added here without touching the emit plumbing.
 */
function isPersistentEvent(event: TimelineEvent): boolean {
  // Ephemeral live-telemetry kinds — never written to JSONL. Replay
  // reconstructs all visible state from the persistent kinds, so
  // these are safe to drop on append.
  //
  //   - `run-status` — phase telemetry the renderer's `LiveStatusRow`
  //     shimmers. Authoritative state lives on `tool-call`,
  //     `phase`, etc.
  //   - `tool-call-args-delta` — streaming partial-args preview;
  //     superseded by the final `tool-call` event.
  //   - `diff-stream` — Phase 2 FS-aware live diff superseded by the
  //     authoritative `tool-result.data.hunks` once the tool runs.
  //   - `synthetic-usage-update` — Phase 3 renderer-side mid-stream
  //     token estimate. The authoritative `token-usage` event lands
  //     at end-of-turn and restores the same final aggregate; the
  //     synthetic stream is pure live telemetry. Also intentionally
  //     never crosses IPC (it originates in chatChannel and stays
  //     in the renderer process), but we list it here defensively
  //     in case the main process ever produces one via a future
  //     emit path.
  //   - `context-usage` — live context-window meter telemetry. The
  //     renderer also derives an at-rest estimate from persisted
  //     `token-usage`, so this stream is meaningless after the fact.
  return (
    event.kind !== 'run-status' &&
    event.kind !== 'tool-call-args-delta' &&
    event.kind !== 'diff-stream' &&
    event.kind !== 'synthetic-usage-update' &&
    event.kind !== 'context-usage'
  );
}

const safeSend = safeWebContentsSend;

export function registerChatIpc(): void {
  wrapIpcHandler(IPC.CHAT_SEND, async (_event, input: ChatSendInput): Promise<ChatSendReply> => {
    assertChatSendInput(input);

    // Resolve the workspace for this run. Priority:
    //   1. `input.workspaceId` from the renderer (the active workspace's id).
    //   2. The bound conversation's persisted `workspaceId`.
    //   3. The currently-active workspace (last-resort fallback so a
    //      pre-multi-workspace renderer can still send).
    // If none of those resolve, we reject the run with a friendly error
    // so the user gets a clear "pick a workspace" path forward.
    let workspaceIdForRun: string | undefined = input.workspaceId;
    if (!workspaceIdForRun && input.conversationId) {
      const meta = await getConversationMeta(input.conversationId);
      workspaceIdForRun = meta?.workspaceId;
    }
    if (!workspaceIdForRun) {
      const active = await getActiveWorkspace();
      workspaceIdForRun = active?.id;
    }
    if (!workspaceIdForRun) {
      throw new Error('No workspace selected. Pick a workspace before sending a message.');
    }

    // Bind / auto-create the conversation. Auto-creation always uses the
    // run's resolved workspace id so a fresh chat lands under the right
    // group in the dock tree.
    //
    // Post-fix, the renderer pre-creates the conversation in
    // `useChatStore.send` before dispatching — so this branch should
    // never fire for renderer-initiated runs. We keep it as defense-
    // in-depth for direct-IPC callers (tests, future integrations)
    // but log a warning: if a real renderer path ever lands here it
    // means the pre-create regressed and the first `user-prompt`
    // event is at risk of being dropped by `applyEvent` again.
    let conversationId = input.conversationId;
    if (!conversationId) {
      log.warn('chat:send auto-creating conversation (renderer should pre-create)', {
        runId: input.runId,
        workspaceId: workspaceIdForRun
      });
      conversationId = (await createConversation(workspaceIdForRun)).id;
    } else {
      // F-018: was `(await listConversations()).some(c => c.id === id)`
      // — O(N) walk over the conversations index. `getConversationMeta`
      // is an O(1) Map lookup against the same in-memory cache, no
      // disk I/O on the cached-meta path. Semantically identical: the
      // walked predicate `id === conversationId` resolves to "does a
      // meta exist for this id?", which is exactly `getConversationMeta`.
      const known = (await getConversationMeta(conversationId)) !== null;
      if (!known) {
        log.warn('chat:send rejected unknown conversationId', { conversationId });
        return {
          ok: false as const,
          kind: 'unknown-conversation' as const,
          conversationId
        };
      }
    }
    const cid = conversationId;

    // Defense in depth against the "conversation switch during run" race:
    // the renderer's `useConversationsStore.select` now aborts the active
    // run before switching, but if that call lands out of order (or a
    // future call site forgets), two concurrent runs writing into the
    // same JSONL would interleave events and corrupt the transcript.
    // Abort EVERY prior run bound to this conversation before starting
    // a new one. The supersede invariant says there's normally at most
    // one — but if a future race leaks two, aborting only the first
    // (the pre-audit behaviour) would leave the second silently
    // streaming into the JSONL. The `findAll…` array surface makes that
    // case impossible by construction, and a count > 1 is logged loudly
    // so the regression is visible.
    //
    // Self-abort safety (review finding M1). The legacy code filtered
    // out `input.runId` before aborting, on the assumption a fresh
    // run could never be in `activeRuns` already. That assumption
    // breaks if the renderer ever reuses a runId (a renderer-side bug
    // in run-id minting, a HMR hot-reload state mismatch, or a buggy
    // replay-and-resend). Without the filter, a renderer-side runId
    // collision now correctly aborts the stale half before starting
    // the new one — `abortRun` is idempotent (it's a no-op for an
    // unknown id and a single signal-flip for the live entry), so
    // there's no cost on the steady-state path.
    const priorRunIds = findAllActiveRunsForConversation(cid);
    if (priorRunIds.length > 0) {
      if (priorRunIds.length > 1) {
        log.warn('chat:send found multiple in-flight runs for conversation; aborting all', {
          conversationId: cid,
          priorRunIds,
          newRunId: input.runId
        });
      } else {
        log.warn('chat:send superseding in-flight run for conversation', {
          conversationId: cid,
          priorRunId: priorRunIds[0],
          newRunId: input.runId
        });
      }
      for (const rid of priorRunIds) abortRun(rid);
      // Await prior run coalescer flush + append drain before reading
      // the JSONL — `abortRun` alone does not wait for `onDone`'s
      // `flushAll()` in the prior closure.
      await awaitRunSettlement(cid);
      await drainAppendChain(cid);
    }

    // Best-effort: stamp the last-used model. Failures must NEVER swallow
    // the run — log instead so a metadata bug can't take down chat.
    //
    // F-019 — INTENTIONAL DUAL WRITE:
    //   - Here (main side): writes `lastModel` onto the conversation
    //     meta. Read on transcript reopen by the renderer's model
    //     picker default (`useChatStore.send` resolves the picker
    //     default from this).
    //   - Renderer side (`useChatStore.send` → `useSettingsStore.
    //     setLastModelByWorkspace`): writes
    //     `AppSettings.ui.lastModelByWorkspace[workspaceId]`. Read
    //     when a brand-new conversation is started in the same
    //     workspace and there is no per-conversation `lastModel` yet.
    //
    // The two writes serve different defaulting paths
    // (per-conversation vs per-workspace) and are NOT redundant. A
    // future refactor that collapses one of them must restore the
    // other defaulting path explicitly. See audit finding F-019.
    setLastModel(cid, input.selection.providerId, input.selection.modelId).catch((err) =>
      log.warn('setLastModel failed', { conversationId: cid, err })
    );

    // Title from the first user prompt (no-op if the conversation already
    // has one). AWAITED so the in-memory index meta is updated BEFORE we
    // return — otherwise the renderer's `useConversationsStore.refresh()`
    // (triggered by `bindActive` after the IPC reply) can race the
    // microtask and pull the stale "New conversation" title. The earlier
    // fire-and-forget pattern produced the screenshot where the dock
    // still read `New conversation` while the agent was actively
    // streaming. The derivation is purely in-memory + scheduled flush;
    // awaiting it costs sub-millisecond on the happy path.
    try {
      await deriveTitleIfFresh(cid, input.prompt);
    } catch (err) {
      log.warn('deriveTitleIfFresh failed', { conversationId: cid, err });
    }

    // Replay prior turns into the orchestrator so it has memory across the
    // conversation. Empty for fresh conversations.
    let priorTranscript: TimelineEvent[] = [];
    try {
      priorTranscript = await readTranscript(cid);
    } catch (err) {
      log.warn('failed to load prior transcript; starting fresh', { conversationId: cid, err });
    }

    // Per-run delta coalescer. Scoped to this closure so it is
    // automatically garbage-collected when the run ends and a fresh
    // buffer is used for the next run. The map is keyed by
    // `assistantMsgId`.
    const coalescer = new Map<string, CoalescerEntry>();
    /**
     * Tombstones for assistant-message ids whose streaming was
     * explicitly terminated via `agent-text-aborted`. Any `delta`
     * event arriving AFTER the abort marker for the same id is
     * dropped from the persistence path (the renderer still receives
     * it via the verbatim forward at the top of `emit`, but the
     * renderer's reducer also filters such late deltas — see
     * `applyTimelineEvent` `agent-text-aborted` branch).
     *
     * Without this guard, a stray late delta would re-create a fresh
     * `CoalescerEntry` and the persisted JSONL would record
     * `...aborted -> delta` — out of order on replay. Review finding
     * H6. The set is unbounded for the run's lifetime; a hostile
     * stream that aborts millions of distinct ids could grow the set,
     * but the same stream would already exhaust other per-id state
     * (coalescer entries, renderer accumulators) long before this
     * Set is the bottleneck.
     */
    const TOMBSTONE_CAP = 10_000;
    const addTombstone = (set: Set<string>, id: string): void => {
      set.add(id);
      if (set.size <= TOMBSTONE_CAP) return;
      const oldest = set.values().next().value;
      if (oldest !== undefined) set.delete(oldest);
    };
    const tombstonedIds = new Set<string>();

    let persistFailureMessage: string | null = null;
    const persistEvent = (event: TimelineEvent): void => {
      appendEvent(cid, event).catch((err) => {
        const message =
          err instanceof Error ? err.message : 'Failed to persist transcript event';
        persistFailureMessage = message;
        log.warn('appendEvent failed', { conversationId: cid, kind: event.kind, err });
      });
    };

    const flushBuf = (buf: DeltaBuf | undefined): void => {
      if (!buf || buf.text.length === 0) return;
      // Emit a synthesized event with the same `kind` + `id` shape as
      // individual deltas — the reducer sums them on replay so one
      // 256-char row is indistinguishable from 256 one-char rows.
      persistEvent({
        kind: buf.kind,
        id: buf.id,
        ts: buf.ts,
        delta: buf.text
      } as TimelineEvent);
      buf.text = '';
    };

    const flushAll = (): void => {
      // Short-circuit on the empty path (review finding M4).
      // `flushAll` runs on every non-streaming persistent event AND
      // on run finalization; on the steady-state path either map is
      // usually empty, so the `Map.size === 0` check skips both
      // for-loops at O(1) cost. The legacy code walked the maps
      // unconditionally — for a turn with 50 tool calls and 5
      // assistant streams open, that was 50 × 5 = 250 wasted
      // iterator allocations.
      if (coalescer.size > 0) {
        for (const entry of coalescer.values()) {
          flushBuf(entry.text);
          flushBuf(entry.reasoning);
        }
        coalescer.clear();
      }
    };

    // Audit fix M-06: run-finalisation latch. After `onDone` /
    // `onError` fires we ignore any further `emit` calls from
    // stragglers — most notably fire-and-forget post-bash mutation
    // scans (`bash.tool.ts`) that complete on the wall-clock AFTER
    // the orchestrator loop's `disposeStreaming` ran. Without this
    // gate those late events still pump through `safeSend` (renderer
    // drops them because the run isn't in the runIdToConv map) AND
    // through `persistEvent` (which APPENDS them to the JSONL,
    // surfacing as ghost rows on transcript reload after a Stop).
    // The flag is closure-local so it lives only for the duration of
    // this run; the next `chat:send` for the same conversation gets
    // its own fresh flag.
    let runFinalized = false;

    armRunSettlement(cid);

    void startRun({ ...input, conversationId: cid, workspaceId: workspaceIdForRun }, {
      emit: (event: TimelineEvent) => {
        if (runFinalized) {
          // Late event from a fire-and-forget task whose run already
          // settled. Dropped — neither forwarded to the renderer nor
          // persisted. Logged at debug so the breadcrumb is available
          // when triaging "why did this checkpoint row appear / not
          // appear" without polluting routine logs.
          log.debug('dropping post-finalisation event', {
            runId: input.runId,
            kind: event.kind
          });
          return;
        }
        // ALWAYS forward to the renderer verbatim so the UI gets
        // token-by-token streaming. The coalescer below only affects
        // what goes to disk.
        safeSend(IPC.CHAT_EVENT, input.runId, event);
        // `run-status` telemetry is forwarded to the renderer but never
        // appended — see `isPersistentEvent` above for the rationale.
        if (!isPersistentEvent(event)) return;

        // Streaming deltas → buffer, flush on threshold. Any other kind
        // implicitly closes the streaming buffer for its assistant
        // turn so persisted event order stays sane (deltas land before
        // their matching `*-end` / `tool-call` / etc.).
        if (
          event.kind === 'agent-text-delta' ||
          event.kind === 'agent-reasoning-delta'
        ) {
          // Drop deltas that arrive after the id has been tombstoned
          // by a prior `agent-text-aborted`. Persisting them would
          // produce an out-of-order `aborted → delta` row pair on
          // replay. Review finding H6.
          if (tombstonedIds.has(event.id)) {
            log.debug('dropping late delta after abort', {
              id: event.id,
              kind: event.kind
            });
            return;
          }
          let entry = coalescer.get(event.id);
          if (!entry) {
            entry = {};
            coalescer.set(event.id, entry);
          }
          const slot = event.kind === 'agent-text-delta' ? 'text' : 'reasoning';
          let buf = entry[slot];
          if (!buf) {
            buf = {
              kind: event.kind,
              id: event.id,
              ts: event.ts,
              text: ''
            };
            entry[slot] = buf;
          }
          buf.text += event.delta;
          if (buf.text.length >= PERSIST_DELTA_COALESCE_CHARS) {
            flushBuf(buf);
          }
          return;
        }

        // End / aborted events: flush the matching buffer BEFORE
        // persisting the boundary marker so the persisted order is
        // `...deltas -> *-end`.
        if (event.kind === 'agent-text-end') {
          const entry = coalescer.get(event.id);
          if (entry) {
            flushBuf(entry.text);
            entry.text = undefined;
            if (!entry.reasoning) coalescer.delete(event.id);
          }
        } else if (event.kind === 'agent-reasoning-end') {
          const entry = coalescer.get(event.id);
          if (entry) {
            flushBuf(entry.reasoning);
            entry.reasoning = undefined;
            if (!entry.text) coalescer.delete(event.id);
          }
        } else if (event.kind === 'agent-text-aborted') {
          // Abort kills BOTH the text and the reasoning accumulators
          // for this id — mirrors the renderer reducer's behavior.
          const entry = coalescer.get(event.id);
          if (entry) {
            flushBuf(entry.text);
            flushBuf(entry.reasoning);
            coalescer.delete(event.id);
          }
          // Tombstone this id so any straggling delta after the abort
          // (provider tail, in-flight chunk delivered after the
          // signal flipped, etc.) is dropped from persistence instead
          // of producing an out-of-order `aborted → delta` row on
          // replay. Review finding H6.
          addTombstone(tombstonedIds, event.id);
        } else {
          // Implicit boundary: any other persistent event kind
          // (`tool-call`, `tool-result`, `phase`, legacy worker lifecycle,
          // `file-edit`, `error`, `token-usage`, `user-prompt`, …)
          // closes the streaming buffer for any in-flight assistant
          // turn so the persisted order stays
          // `...deltas -> *-end -> next-event`. The previous
          // implementation ONLY flushed on `*-end` / `*-aborted`,
          // which left the comment above honest only because the
          // orchestrator's emit path always emits `agent-text-end`
          // before the first `tool-call` (see `runLoop.ts`'s
          // turn-end block). A future emit-order change — e.g.
          // mid-stream tool-call detection paralleling the existing
          // mid-stream legacy orchestration markup — would otherwise
          // silently reorder events on disk and break replay
          // ordering for any consumer that walks the JSONL in file
          // order. Flushing every entry here makes the invariant
          // structural rather than circumstantial. `flushBuf` zeroes
          // the buffer text, so the next delta for the same id
          // starts a fresh accumulator without losing any chars.
          for (const entry of coalescer.values()) {
            flushBuf(entry.text);
            flushBuf(entry.reasoning);
          }
        }

        // Non-delta events persist verbatim.
        persistEvent(event);
      },
      onDone: () => finalizeRunDurability('done'),
      onError: (message: string) => finalizeRunDurability('error', message),
      onAwaitingUser: () => {
        flushAll();
        safeSend(IPC.CHAT_AWAITING_USER, input.runId);
      }
    }, priorTranscript).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      log.error('startRun failed', { runId: input.runId, conversationId: cid, err });
      finalizeRunDurability('error', message);
    });

    function finalizeRunDurability(mode: 'done' | 'error', runErrorMessage?: string): void {
      flushAll();
      runFinalized = true;
      drainAppendChain(cid)
        .catch((drainErr: unknown) => {
          const drainMessage =
            drainErr instanceof Error ? drainErr.message : 'Failed to persist transcript';
          if (!persistFailureMessage) {
            persistFailureMessage = drainMessage;
          }
          log.warn('drainAppendChain failed during run finalization', {
            conversationId: cid,
            err: drainErr
          });
        })
        .finally(() => {
          settleRun(cid);
          const message =
            persistFailureMessage ?? (mode === 'error' ? runErrorMessage : undefined);
          if (mode === 'error' || message) {
            safeSend(IPC.CHAT_ERROR, input.runId, message ?? 'Run failed');
          } else {
            safeSend(IPC.CHAT_DONE, input.runId);
          }
        });
    }

    return { ok: true as const, conversationId: cid };
  });

  wrapIpcHandler(IPC.CHAT_ABORT, async (_event, runId: string) => {
    assertString('chat:abort', 'runId', runId);
    abortRun(runId);
  });

  wrapIpcHandler(IPC.CHAT_SUBMIT_ASK_USER, async (_event, input) => {
    assertAskUserSubmitInput(input);
    const pausedRunId = findPausedRunForConversation(input.conversationId);
    if (!pausedRunId || pausedRunId !== input.runId) {
      return {
        ok: false as const,
        kind: 'not-awaiting-user' as const,
        message: 'No paused ask_user run for this conversation.'
      };
    }
    const ok = await submitAskUserAnswers(input);
    if (!ok) {
      return {
        ok: false as const,
        kind: 'unknown-run' as const,
        message: 'Failed to resume the paused run.'
      };
    }
    return { ok: true as const };
  });

  // Snapshot of every orchestrator run currently in flight in main.
  // The renderer calls this once at boot (from `bootstrapChatChannel`)
  // to rehydrate its `runId → conversation` dispatch table after a
  // renderer reload. Cheap O(N) iteration over a Map that's typically
  // ≤ a handful of entries.
  wrapIpcHandler(IPC.CHAT_LIST_ACTIVE_RUNS, async () => listActiveRuns());
}
