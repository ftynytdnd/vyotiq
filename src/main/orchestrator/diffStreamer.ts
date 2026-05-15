/**
 * FS-aware live diff streamer (Phase 2 of the streaming-diffs plan).
 *
 * The orchestrator and every sub-agent already emit a
 * `tool-call-args-delta` event for every fragment of a streaming
 * tool call (see `consumeChatStream.onToolCallArgsDelta`). This
 * module subscribes to that same hook and, for `edit` / `delete`
 * calls, reads the target file body once on first delta then emits
 * a `diff-stream` event per delta carrying the LCS hunks the
 * tool would actually produce against the on-disk body.
 *
 * Design rules:
 *   1. **Single-flight per callId.** Only one diff job runs at a
 *      time per call. If a new delta lands while the previous one
 *      is still computing, the prior result is discarded and the
 *      new one starts (latest-wins; the cumulative `argsBuf`
 *      contract in `tool-call-args-delta` makes this safe — every
 *      delta is a strict prefix superset of the previous).
 *   2. **Idempotent file read.** The target file body is read once
 *      per `(runId, callId)` and cached. A second read for the
 *      same callId is a hit, even across many deltas.
 *   3. **Sandbox-checked.** Paths are resolved through the same
 *      `realpathInsideWorkspace` guard the `edit` tool uses; an
 *      escape attempt produces no event (silent skip — no ambient
 *      authority leak).
 *   4. **Bounded.** Files larger than `MAX_DIFF_BODY_BYTES` are
 *      skipped entirely. The synthesised renderer-side preview
 *      remains as a fallback.
 *   5. **Non-persistent.** `diff-stream` is dropped from the
 *      JSONL transcript by `chat.ipc.ts:isPersistentEvent`, so
 *      replay reconstructs visible state from the authoritative
 *      `tool-result.data.hunks` only — this stream is pure live
 *      telemetry.
 *   6. **Zero-leak teardown.** All per-call state is dropped on
 *      `dispose()` (called by the orchestrator on run end / abort)
 *      and on `notifySettled` (called when the authoritative
 *      `tool-call` event is about to be emitted).
 *
 * Performance: `computeDiffHunks` is O(n·m) on lines. We bound
 * inputs to `MAX_DIFF_BODY_BYTES` (256 KB) which translates to a
 * worst case of ~12K × 12K = 150M ops if every line of the body
 * differs from every line of the after — well within main-thread
 * budget for the streaming cadence (we throttle through the same
 * single-flight gate). For the typical case (a small `oldString` /
 * `newString` against a moderate file body) the cost is dominated
 * by the file read, not the LCS walk.
 *
 * Out of scope (deferred):
 *   - Worker-thread offload for very large files. The plan reserved
 *     a 64 KB threshold for this; we keep the door open via
 *     `MAX_DIFF_BODY_BYTES` (lower than would warrant a worker
 *     thread for the moment) and revisit if profiling shows main-
 *     thread blocking.
 *   - `bash`-write detection. Lives in a separate module
 *     (`bashWriteDetector.ts`) that feeds the same streamer.
 */

import { promises as fs } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { TimelineEvent } from '@shared/types/chat.js';
import type { DiffHunk } from '@shared/types/tool.js';
import { computeDiffHunks } from '@shared/text/diff/computeDiffHunks.js';
import { synthesizeCreateHunks } from '@shared/text/diff/synthesizeCreateHunks.js';
import {
  realpathInsideWorkspace,
  resolveCreateInsideWorkspace,
  workspaceRelative
} from '../tools/sandbox.js';
import { logger } from '../logging/logger.js';
import { tryParseBashWrite, type BashWriteOp } from './bashWriteParser.js';

const log = logger.child('diffStreamer');

/** Hard cap on the file body the streamer will read. Files above
 *  this size silently skip the stream and the renderer falls back
 *  to the synthesised preview. Raised from 256 KB to 1 MB now that
 *  the LCS can run off-thread via `DiffWorkerPool` — even a 1 MB
 *  LCS only costs ~300ms on the worker, which never blocks the UI. */
const MAX_DIFF_BODY_BYTES = 1024 * 1024;

/** Threshold above which the streamer prefers off-main-thread LCS
 *  (when a `computeHunksAsync` driver is supplied). Below this,
 *  inline compute is always fast (<5ms for a 32 KB body on a
 *  typical laptop) and avoids the worker-hop latency (~1ms RTT). */
const WORKER_THRESHOLD_BYTES = 64 * 1024;

/**
 * Per-call working state. The streamer owns one of these per
 * `(runId, callId)` pair until `dispose` or `notifySettled` clears
 * it. Carrying both `runId` and `callId` (and not just keying by
 * `callId`) preserves run-level isolation: the same callId could
 * theoretically appear under a different `runId` in a tightly
 * concurrent test, and we don't want diff state crossing.
 */
interface CallState {
  runId: string;
  callId: string;
  subagentId?: string;
  /** Workspace-relative path the diff is against (display-friendly). */
  filePath: string;
  /** Cached file body. `null` until the lazy load resolves. */
  body: string | null;
  /** When the cache load is in flight. */
  loading: Promise<string | null> | null;
  /** A diff job is in flight; the next delta will start a fresh one when this clears. */
  computing: boolean;
  /** Latest snapshot we've emitted. Latest-wins per callId. */
  latestHash: string;
  /**
   * The hunks payload we last emitted, retained so `notifySettled`
   * can re-emit a final `diff-stream` event with `settled: true`
   * (audit fix H8). Cleared on `dispose()` along with the rest of
   * the state. `null` until the first successful emit; subsequent
   * `notifySettled` calls before any emit are a no-op.
   */
  lastHunks: DiffHunk[] | null;
  /** Tool kind cached alongside `lastHunks` for the settle re-emit. */
  lastTool: 'edit' | 'delete' | 'bash' | null;
  /** Aggregate stats cached alongside `lastHunks`. */
  lastAdditions: number;
  lastDeletions: number;
  /**
   * Hash of the most recent args we've ACCEPTED (not necessarily yet
   * emitted). Updated synchronously in `onArgsDelta` so duplicate
   * deltas with identical args short-circuit on the cheap gate. Audit
   * fix H1 — previously this was set inside `computeAndEmit` AFTER
   * the single-flight gate, so a delta that landed mid-compute would
   * stamp this with its own hash and then any subsequent identical
   * delta (or this one's successor with the same args) would be
   * silently skipped.
   */
  lastArgsHash: string;
  /**
   * Hash of the most recent args queued behind an in-flight compute.
   * Drained by the `finally` block in `computeAndEmit` so the latest-
   * wins contract documented in the file header is actually upheld.
   * Audit fix H1.
   */
  pendingArgs: PendingArgs | null;
  /** Set on settlement so we ignore further deltas. */
  closed: boolean;
}

interface PendingArgs {
  tool: 'edit' | 'delete' | 'bash';
  snapshot: DiffStreamerArgsDelta;
  argsHash: string;
  path: string;
  bashOp: BashWriteOp | null;
}

/**
 * Public hook the orchestrator wires into `consumeChatStream`'s
 * `onToolCallArgsDelta`. The DiffStreamer instance is owned for the
 * lifetime of one orchestrator turn or one sub-agent iteration.
 */
export interface DiffStreamerArgsDelta {
  callId: string;
  /** Tool name as far as the streamer knows it. May be `undefined` early. */
  name: string | undefined;
  /** Best-effort parsed args snapshot from the partial-JSON parser. */
  parsed: Record<string, unknown> | null;
  /** Sub-agent id when applicable (orchestrator scope when `undefined`). */
  subagentId?: string;
}

/**
 * Streamer dependencies. Decoupled so tests can drop in a
 * different `readFile` (e.g. an in-memory FS) and assert the
 * emitted events.
 */
export interface DiffStreamerDeps {
  /** Workspace root absolute path — sandbox anchor. */
  workspacePath: string;
  /** Run id used to scope teardown and emit IDs. */
  runId: string;
  /** Emit a single `TimelineEvent` to the renderer. */
  emit: (event: TimelineEvent) => void;
  /** Inject a mocked reader in tests; defaults to `fs.readFile`. */
  readFile?: (abs: string) => Promise<string>;
  /**
   * Optional off-main-thread LCS driver. When supplied AND the
   * body size exceeds `WORKER_THRESHOLD_BYTES`, the streamer
   * routes `computeDiffHunks` through this function instead of
   * running it on the main thread. Falls back to inline compute
   * on rejection so a worker crash never loses the preview.
   *
   * Production wiring instantiates a `DiffWorkerPool` (see
   * `diffWorkerPool.ts`) and passes its `computeHunks` method.
   * Tests omit this to keep compute in-process and deterministic.
   */
  computeHunksAsync?: (before: string, after: string) => Promise<DiffHunk[]>;
}

export class DiffStreamer {
  private readonly deps: DiffStreamerDeps;
  private readonly states = new Map<string, CallState>();
  /**
   * CallIds we've finalised via `notifySettled`. Persists for the
   * lifetime of this streamer (until `dispose()`) so a late delta
   * arriving after the authoritative `tool-call` event is silently
   * dropped instead of resurrecting a fresh state. The set is
   * bounded by the number of distinct callIds in a single run,
   * which has its own ceiling (`MAX_TOTAL_ITERATIONS` × parallel
   * fan-out) so unbounded growth is not a concern.
   */
  private readonly settledCallIds = new Set<string>();

  constructor(deps: DiffStreamerDeps) {
    this.deps = deps;
  }

  /**
   * Hand a fresh args-delta snapshot to the streamer. The streamer
   * resolves the path, reads the file body lazily, computes the
   * diff against the synthesised post-state, and emits a
   * `diff-stream` event on success.
   *
   * Returns synchronously; the actual diff job runs asynchronously
   * in the background. Failures are logged at debug and never
   * propagate — the renderer's synthesised preview remains as a
   * graceful fallback for any path that can't produce an FS-aware
   * diff.
   */
  onArgsDelta(snapshot: DiffStreamerArgsDelta): void {
    if (!snapshot.parsed) return; // not enough structure yet
    if (this.settledCallIds.has(snapshot.callId)) return; // post-settle straggler
    const tool = snapshot.name;
    if (tool !== 'edit' && tool !== 'delete' && tool !== 'bash') return;

    // CREATE branch — sub-agents do every file create the system ever
    // performs (the orchestrator delegates ALL file ops). Pre-fix this
    // branch silently returned, so for `create: true` calls no
    // `diff-stream` event ever fired. That meant
    // `ToolGroupRow.liveAutoExpand` (which gates on
    // `partial && diffStream != null`) stayed `false`, the rolled-up
    // sub-agent tool group never auto-expanded, and the
    // `EditInvocation`'s renderer-side `create-preview` (with the
    // green-tinted `+` lines + trailing `vyotiq-stream-cursor`) was
    // hidden behind a collapsed row. The user's report — "subagents
    // are not rendering and streaming and displaying the live
    // streaming of the diffs automatically (exactly same like the
    // models internal reasoning panel)" — landed on this gap.
    //
    // Post-fix: emit a `diff-stream` event with all-`+` hunks against
    // an empty before-body. The hunks are byte-identical to what the
    // renderer's `synthesizeCreateHunks` would compute locally, so
    // (a) the auto-expand signal fires the same way modify edits do,
    // (b) `toolGroupDiffStats` already aggregates either source, and
    // (c) `notifySettled` re-emits with `settled: true` once the
    // authoritative `tool-call` lands — same lifecycle as modifies.
    if (tool === 'edit' && snapshot.parsed['create'] === true) {
      void this.handleCreateDelta(snapshot);
      return;
    }

    let path: string;
    let bashOp: BashWriteOp | null = null;
    if (tool === 'bash') {
      // Bash detection is best-effort. The parser ONLY recognises a
      // small set of single-target write patterns (heredoc / echo /
      // printf to a literal path). Anything outside that surface is
      // silently skipped — false positives would produce a wrong
      // diff preview, which is worse than no preview.
      const command = snapshot.parsed['command'];
      if (typeof command !== 'string' || command.length === 0) return;
      bashOp = tryParseBashWrite(command);
      if (!bashOp) return;
      path = bashOp.filePath;
    } else {
      const rawPath = snapshot.parsed['path'];
      if (typeof rawPath !== 'string' || rawPath.length === 0) return;
      path = rawPath;
    }

    const cacheKey = snapshot.callId;
    const existing = this.states.get(cacheKey);
    if (existing && existing.closed) return;

    const argsHash = this.hashArgs(tool, snapshot.parsed, bashOp);
    if (existing && existing.lastArgsHash === argsHash) {
      // Same args as the previous delta — nothing changed beyond the
      // raw buffer, no need to re-compute. Note: we update
      // `lastArgsHash` SYNCHRONOUSLY in `computeAndEmit` below the
      // single-flight gate AND we set it on the queued `pendingArgs`
      // path too, so this gate correctly reflects "have we already
      // accepted this exact hash for compute or queue".
      return;
    }

    if (existing && existing.computing) {
      // A compute is in flight. Don't drop this delta on the floor —
      // queue it as the next-up. Audit fix H1: previously the gate
      // inside `computeAndEmit` would set `lastArgsHash` and then
      // return on `computing`, so subsequent identical deltas
      // short-circuited at the top gate above and the never-emitted
      // hash was lost permanently.
      existing.lastArgsHash = argsHash;
      existing.pendingArgs = { tool, snapshot, argsHash, path, bashOp };
      return;
    }

    void this.computeAndEmit(tool, snapshot, argsHash, path, bashOp);
  }

  /**
   * Mark the call as settled — the authoritative `tool-call` event
   * is about to be emitted. The streamer emits one final
   * `diff-stream` with `settled: true` so the renderer flips to
   * settled styling immediately, then stops accepting deltas for
   * this callId.
   *
   * Idempotent. No-op for callIds the streamer never saw (the call
   * may have been a tool the streamer ignores).
   *
   * Surrogate reconciliation (audit fix — May 2026):
   *   When the provider's first delta arrived without a real `id`,
   *   the streamer keyed its `CallState` under
   *   `pending:${owner}:${index}`. Once the real id lands the call
   *   site invokes `notifySettled(realCallId, owner)` and we walk
   *   the state map for the lowest-index surrogate matching that
   *   owner — same logic the renderer reducer's `clearPartialFor`
   *   uses. The surrogate state is folded into the real id (its
   *   cached `lastHunks` re-emit under the real callId with
   *   `settled: true`) and dropped, so a long session ends with
   *   `states.size === 0` even when surrogate→real transitions
   *   happen mid-stream. Both ids land in `settledCallIds` so any
   *   straggler delta on either id is ignored by `onArgsDelta`'s
   *   top gate.
   */
  notifySettled(callId: string, owner?: string, index?: number): void {
    // Even if we never started a state for this callId (e.g. the
    // first delta hadn't landed before the authoritative
    // `tool-call`), remember the settle so any LATE delta is
    // ignored. Belt-and-suspenders against frame reordering.
    this.settledCallIds.add(callId);

    // Direct match first — the common case where the provider sent
    // the real id on the first frame, so the surrogate path was
    // never used.
    let cur = this.states.get(callId);

    // Surrogate fold-in. When the provider transitioned `id` from
    // `undefined` → real mid-stream, the streamer may carry a
    // `pending:${owner}:${idx}` state we still need to reconcile.
    let surrogateKey: string | null = null;
    if (owner) {
      if (typeof index === 'number') {
        const exact = `pending:${owner}:${index}`;
        if (exact !== callId && this.states.has(exact)) surrogateKey = exact;
      }
      if (surrogateKey === null) {
        // Walk for the lowest-index surrogate matching this owner.
        // The runtime processes settled tool calls in index order,
        // so the FIRST authoritative `tool-call` corresponds to the
        // LOWEST-index surrogate (mirrors `clearPartialFor` in
        // `applyTimelineEvent.ts`).
        const prefix = `pending:${owner}:`;
        let lowest = Number.POSITIVE_INFINITY;
        for (const key of this.states.keys()) {
          if (key === callId) continue;
          if (!key.startsWith(prefix)) continue;
          const idxRaw = key.slice(prefix.length);
          const idxN = Number(idxRaw);
          if (Number.isFinite(idxN) && idxN < lowest) {
            lowest = idxN;
            surrogateKey = key;
          }
        }
      }
    }

    if (surrogateKey) {
      // Mark the surrogate id as settled too so any delta racing
      // the settle on the surrogate id is dropped.
      this.settledCallIds.add(surrogateKey);
      // Promote the surrogate's cached hunks when the real-id state
      // doesn't exist yet (the only deltas the streamer ever saw
      // came in under the surrogate).
      if (!cur) cur = this.states.get(surrogateKey);
      this.states.delete(surrogateKey);
    }

    if (!cur || cur.closed) {
      // Already settled or never seen. Drop the state if it
      // existed (defensive — the cleanup path also removes it).
      this.states.delete(callId);
      return;
    }
    cur.closed = true;
    cur.pendingArgs = null;

    // Re-emit the cached hunks with `settled: true`. Audit fix H8.
    // The renderer's reducer flips the partial entry's `diffStream.settled`
    // bit instantly, so the user sees the settle styling without
    // waiting for the authoritative `tool-call` event to land. When
    // we never produced an emit (e.g. the file was unreadable, or
    // the args never described a complete substitution), there's
    // nothing to re-emit and the renderer falls back to the
    // standard partial → settled transition driven by the
    // `tool-call` reducer branch.
    //
    // The emit always carries the REAL `callId` (not the surrogate
    // key) so the renderer pairs the settle event with the same id
    // the authoritative `tool-call` will carry — the renderer's
    // own `clearPartialFor` then drops the surrogate partial entry
    // when the matching `tool-call` reducer branch runs.
    if (cur.lastHunks !== null && cur.lastTool !== null) {
      this.deps.emit({
        kind: 'diff-stream',
        id: randomUUID(),
        ts: Date.now(),
        callId,
        tool: cur.lastTool,
        filePath: cur.filePath,
        hunks: cur.lastHunks,
        additions: cur.lastAdditions,
        deletions: cur.lastDeletions,
        settled: true,
        ...(cur.subagentId !== undefined ? { subagentId: cur.subagentId } : {})
      });
    }
    this.states.delete(callId);
  }

  /**
   * Drop every per-call state. Called by the orchestrator on run
   * end (success or failure) so a long session never accumulates
   * dead entries. Also called when the abort signal fires.
   */
  dispose(): void {
    this.states.clear();
    this.settledCallIds.clear();
  }

  // ---- Internals ----

  private hashArgs(
    tool: 'edit' | 'delete' | 'bash',
    parsed: Record<string, unknown>,
    bashOp: BashWriteOp | null
  ): string {
    // Cheap content hash for change detection. We don't want to
    // re-walk the LCS on every byte; only when the string contents
    // change. Using `JSON.stringify` here is bounded by the
    // partial-args ceiling (<32 KB typical) and produces a
    // deterministic key.
    if (tool === 'delete') {
      return `del:${parsed['path'] ?? ''}`;
    }
    if (tool === 'bash') {
      // The bash hash is keyed off the EXTRACTED write op, NOT the
      // raw command, so two different command spellings that
      // produce the same `{ filePath, newContent }` (e.g. swapping
      // single quotes for double) coalesce to one emit.
      const op = bashOp!;
      return `bash:${op.filePath}:${op.newContent.length}:${op.newContent}`;
    }
    const path = parsed['path'] ?? '';
    const oldStr = typeof parsed['oldString'] === 'string' ? parsed['oldString'] : '';
    const newStr = typeof parsed['newString'] === 'string' ? parsed['newString'] : '';
    const replaceAll = parsed['replaceAll'] === true ? '1' : '0';
    return `edit:${path}:${replaceAll}:${oldStr.length}:${newStr.length}:${oldStr}\u0000${newStr}`;
  }

  /**
   * Emit a `diff-stream` event for an in-flight `edit` call with
   * `create: true`. The before-body is empty by definition (the file
   * doesn't exist yet — `resolveCreateInsideWorkspace` is the
   * sandbox-safe resolver for non-existent paths), so the hunks are
   * the same all-`+` shape `synthesizeCreateHunks` produces. Reusing
   * the per-call `CallState` slot means `notifySettled` sees the
   * cached `lastHunks` / `lastTool` and re-emits with `settled: true`
   * the same way it does for modify edits — no special-case branch
   * needed in the settle path.
   *
   * Streaming-safe: the partial-JSON parser hands us cumulative
   * `content` snapshots, so each delta produces a strictly larger
   * (or equal) hunk. The `latestHash` dedup gate short-circuits
   * identical re-emits, so a stalled provider that re-sends the
   * same partial is a no-op.
   */
  private async handleCreateDelta(snapshot: DiffStreamerArgsDelta): Promise<void> {
    if (this.settledCallIds.has(snapshot.callId)) return;
    const path = snapshot.parsed?.['path'];
    const content = snapshot.parsed?.['content'];
    // Need both a path and at least one byte of content before we
    // can paint anything useful. `synthesizeCreateHunks('')` would
    // produce `[{ kind: '+', text: '' }]` — a single empty `+`
    // line — which is technically valid but reads as noise; the
    // renderer-side preview also short-circuits on empty content.
    if (typeof path !== 'string' || path.length === 0) return;
    if (typeof content !== 'string' || content.length === 0) return;

    const callId = snapshot.callId;
    let cur = this.states.get(callId);
    if (cur && cur.closed) return;

    // Cheap dedup gate. The cumulative `content` strictly grows;
    // length + final-byte hash collisions are negligible in
    // practice and the worst case is one redundant emit on a
    // collision. Keeps the streamer O(delta) on the parse cost
    // alone.
    const argsHash = `create:${path}:${content.length}:${fnv1a(content)}`;
    if (cur && cur.lastArgsHash === argsHash) return;

    let abs: string;
    try {
      // Create-aware resolver: walks up to the deepest existing
      // ancestor and validates that THAT directory is inside the
      // workspace, so a symlinked mid-path can't escape. Same
      // sandbox guarantee the `edit` tool's create branch uses.
      abs = await resolveCreateInsideWorkspace(this.deps.workspacePath, path);
    } catch {
      // Path escapes workspace; silent skip — never leak hunks for
      // a path the user didn't grant access to.
      return;
    }

    // Re-fetch state in case `dispose()` ran during the await.
    cur = this.states.get(callId);
    if (cur && cur.closed) return;
    if (!cur) {
      cur = {
        runId: this.deps.runId,
        callId,
        ...(snapshot.subagentId !== undefined ? { subagentId: snapshot.subagentId } : {}),
        filePath: workspaceRelative(this.deps.workspacePath, abs),
        // Empty before-body: a fresh create has nothing on disk to
        // diff against. Setting it directly skips the lazy
        // `loadBody` path so we never hit the FS for create calls.
        body: '',
        loading: null,
        computing: false,
        latestHash: '',
        lastHunks: null,
        lastTool: null,
        lastAdditions: 0,
        lastDeletions: 0,
        lastArgsHash: '',
        pendingArgs: null,
        closed: false
      };
      this.states.set(callId, cur);
    }
    cur.lastArgsHash = argsHash;

    const hunks = synthesizeCreateHunks(content);
    const stats = countHunkStats(hunks);
    const renderHash = fnv1a(JSON.stringify(hunks));
    if (renderHash === cur.latestHash) return;
    cur.latestHash = renderHash;
    cur.lastHunks = hunks;
    cur.lastTool = 'edit';
    cur.lastAdditions = stats.additions;
    cur.lastDeletions = stats.deletions;

    const event: TimelineEvent = {
      kind: 'diff-stream',
      id: randomUUID(),
      ts: Date.now(),
      callId,
      tool: 'edit',
      filePath: cur.filePath,
      hunks,
      additions: stats.additions,
      deletions: stats.deletions,
      ...(cur.subagentId !== undefined ? { subagentId: cur.subagentId } : {})
    };
    this.deps.emit(event);
  }

  private async loadBody(callId: string, abs: string): Promise<string | null> {
    const reader = this.deps.readFile ?? ((p) => fs.readFile(p, 'utf8'));
    try {
      // Stat first so we can bail out on oversized files without
      // pulling them into memory.
      const stat = await fs.stat(abs).catch(() => null);
      if (stat && stat.size > MAX_DIFF_BODY_BYTES) {
        log.debug('skipping diff stream — file exceeds cap', {
          callId,
          size: stat.size,
          cap: MAX_DIFF_BODY_BYTES
        });
        return null;
      }
      return await reader(abs);
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code === 'ENOENT') {
        // The target doesn't exist on disk yet — typically a sub-agent
        // bash-write to a new path (`cat > new.ts`) or any tool whose
        // streaming preview should diff against "empty before-body".
        // Treat as an empty body so the LCS produces all-`+` hunks,
        // matching what the authoritative post-write `tool-result`
        // will eventually carry. Pre-fix this returned `null` →
        // `cur.closed = true` and the streamer never emitted for
        // bash creates either, leaving the row collapsed under the
        // same auto-expand gate that broke for `edit create: true`.
        return '';
      }
      if (code === 'EISDIR' || code === 'EACCES') {
        // Genuinely unreadable surface; the renderer's synthesised
        // preview still renders the model's intent.
        return null;
      }
      log.debug('diff streamer file read failed', { callId, err });
      return null;
    }
  }

  private async computeAndEmit(
    tool: 'edit' | 'delete' | 'bash',
    snapshot: DiffStreamerArgsDelta,
    argsHash: string,
    path: string,
    bashOp: BashWriteOp | null
  ): Promise<void> {
    const callId = snapshot.callId;
    let cur = this.states.get(callId);
    let abs: string;
    try {
      abs = await realpathInsideWorkspace(this.deps.workspacePath, path);
    } catch {
      // Path escapes workspace or symlinks outside; silent skip.
      return;
    }
    if (!cur) {
      cur = {
        runId: this.deps.runId,
        callId,
        ...(snapshot.subagentId !== undefined ? { subagentId: snapshot.subagentId } : {}),
        filePath: workspaceRelative(this.deps.workspacePath, abs),
        body: null,
        loading: null,
        computing: false,
        latestHash: '',
        lastHunks: null,
        lastTool: null,
        lastAdditions: 0,
        lastDeletions: 0,
        lastArgsHash: '',
        pendingArgs: null,
        closed: false
      };
      this.states.set(callId, cur);
    }
    cur.lastArgsHash = argsHash;

    // Lazy body load. Coalesced via `loading` so multiple deltas
    // landing during the read share the same in-flight read.
    if (cur.body === null) {
      if (cur.loading === null) {
        cur.loading = this.loadBody(callId, abs);
      }
      const body = await cur.loading;
      // Re-fetch state in case `dispose()` ran during the await.
      cur = this.states.get(callId);
      if (!cur) return;
      cur.loading = null;
      if (body === null) {
        // Soft-skip: file isn't readable (oversized / ENOENT / EACCES).
        // Keep the state in place but mark it `closed` so the cheap
        // top-level gate in `onArgsDelta` short-circuits any future
        // deltas without paying another FS round-trip. Audit fix H2 —
        // previously this path called `this.states.delete(callId)`
        // which caused the next delta to recreate the state and re-stat
        // the same unreadable file. Settled-set membership additionally
        // belt-and-suspenders the early-return on `onArgsDelta:185`.
        cur.body = null;
        cur.closed = true;
        cur.pendingArgs = null;
        this.settledCallIds.add(callId);
        return;
      }
      cur.body = body;
    }

    // Single-flight gate. If another compute is mid-flight, queue
    // these args as the next-up so the `finally` below picks them
    // up — preserves the latest-wins semantics promised in the
    // file header. Audit fix H1.
    if (cur.computing) {
      cur.pendingArgs = { tool, snapshot, argsHash, path, bashOp };
      return;
    }
    cur.computing = true;
    try {
      let updated: string | null;
      if (tool === 'edit') {
        updated = this.synthesiseEditPostBody(cur.body!, snapshot.parsed!);
      } else if (tool === 'bash') {
        // Bash full-file write: the parsed op IS the new body.
        updated = bashOp!.newContent;
      } else {
        updated = ''; // delete → empty after-body
      }
      if (updated === null) {
        // The args don't yet describe a complete edit (e.g.
        // `oldString` is mid-stream and won't match the body).
        return;
      }
      // Route large bodies through the async worker when one is
      // configured; fall back to inline if the worker rejects so a
      // transient crash never loses the preview.
      const bodyLen = cur.body!.length;
      let hunks: DiffHunk[];
      if (
        this.deps.computeHunksAsync &&
        (bodyLen >= WORKER_THRESHOLD_BYTES || updated.length >= WORKER_THRESHOLD_BYTES)
      ) {
        try {
          hunks = await this.deps.computeHunksAsync(cur.body!, updated);
          // Re-fetch state after the await — `dispose()` or a
          // late `notifySettled` could have closed this call.
          const post = this.states.get(callId);
          if (!post || post.closed) return;
          cur = post;
        } catch (err) {
          log.debug('worker LCS failed — falling back to inline', { callId, err });
          hunks = computeDiffHunks(cur.body!, updated);
        }
      } else {
        hunks = computeDiffHunks(cur.body!, updated);
      }
      const stats = countHunkStats(hunks);
      // Content-aware dedup: hash on the full hunk shape so a
      // model extending `newString` byte-by-byte (same `+N -M`
      // counts but different text) still triggers a re-emit. The
      // hash isn't cryptographic — collision resistance is
      // unnecessary; we only need different inputs to produce
      // different strings within a single in-flight call.
      const renderHash = fnv1a(JSON.stringify(hunks));
      if (renderHash === cur.latestHash) {
        // Same diff as the last emit — silent.
        return;
      }
      cur.latestHash = renderHash;
      // Cache for the settle re-emit. Audit fix H8.
      cur.lastHunks = hunks;
      cur.lastTool = tool;
      cur.lastAdditions = stats.additions;
      cur.lastDeletions = stats.deletions;
      const event: TimelineEvent = {
        kind: 'diff-stream',
        id: randomUUID(),
        ts: Date.now(),
        callId,
        tool,
        filePath: cur.filePath,
        hunks,
        additions: stats.additions,
        deletions: stats.deletions,
        ...(cur.subagentId !== undefined ? { subagentId: cur.subagentId } : {})
      };
      this.deps.emit(event);
    } catch (err) {
      log.debug('diff stream compute threw', { callId, err });
    } finally {
      // Guard against `dispose()` having cleared us mid-flight.
      const refreshed = this.states.get(callId);
      if (!refreshed) return;
      refreshed.computing = false;

      // Drain queued args. Audit fix H1: a delta that landed during
      // this compute was stashed on `pendingArgs` instead of being
      // dropped on the floor. If its hash is the one we just
      // emitted, skip; otherwise kick off the next compute. The
      // recursion is guaranteed to terminate because each
      // re-entry either emits (advancing `latestHash`) or hits the
      // `updated === null` early-return.
      if (refreshed.closed) return;
      const queued = refreshed.pendingArgs;
      if (!queued) return;
      refreshed.pendingArgs = null;
      void this.computeAndEmit(
        queued.tool,
        queued.snapshot,
        queued.argsHash,
        queued.path,
        queued.bashOp
      );
    }
  }

  /**
   * Apply the streaming `oldString → newString` to the cached file
   * body, mirroring the `edit` tool's MODIFY branch. Returns
   * `null` when the args don't yet describe a substitution that
   * lands in the body — the renderer's synthesised preview is the
   * fallback in that window.
   */
  private synthesiseEditPostBody(
    body: string,
    args: Record<string, unknown>
  ): string | null {
    const oldString = args['oldString'];
    const newString = args['newString'];
    if (typeof oldString !== 'string' || typeof newString !== 'string') {
      return null;
    }
    if (oldString.length === 0 || oldString === newString) return null;

    if (args['replaceAll'] === true) {
      // Walk and splice each occurrence in turn.
      let work = body;
      let cursor = 0;
      let any = false;
      // Cap iterations defensively. The streaming case shouldn't
      // hit pathological replace-all loops.
      let safety = 1024;
      while (safety-- > 0) {
        const idx = work.indexOf(oldString, cursor);
        if (idx === -1) break;
        any = true;
        work = work.slice(0, idx) + newString + work.slice(idx + oldString.length);
        cursor = idx + newString.length;
      }
      return any ? work : null;
    }
    const idx = body.indexOf(oldString);
    if (idx === -1) return null; // anchor not found yet
    return body.slice(0, idx) + newString + body.slice(idx + oldString.length);
  }
}

function countHunkStats(hunks: DiffHunk[]): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  for (const h of hunks) {
    for (const l of h.lines) {
      if (l.kind === '+') additions++;
      else if (l.kind === '-') deletions++;
    }
  }
  return { additions, deletions };
}

/**
 * FNV-1a 32-bit string hash. Used to dedup `diff-stream` emissions
 * by hunk-array content without paying the cost of comparing the
 * full JSON string on every delta. Collision resistance is
 * unnecessary — we only need different inputs to produce different
 * outputs within a single in-flight call.
 */
function fnv1a(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}
