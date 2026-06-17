/**
 * Context manager. Builds the dynamic envelope wrappers (workspace context,
 * session context, prior conversations, recent memory, meta-rules) and
 * inlines attachment files for the user envelope. History reduction (tiered,
 * reversible-first) is owned by the context-management system, gated by
 * `settings.ui.agentBehavior.contextManagement` (on by default) — see
 * `docs/context-management-design.md`. This module also surfaces the
 * agent-maintained `<run_progress>` note in the runtime tail.
 */

import { createHash } from 'node:crypto';
import { basename } from 'node:path';
import { promises as fs } from 'node:fs';
import { redactUserHomeInPath } from '@shared/path/redactUserHomeInPath.js';
import { escapeXmlAttr, wrapXml } from './envelope/index.js';
import { retrieveRelevantMemory } from '../memory/retrieval.js';
import { readWorkspaceNote } from '../memory/workspaceNotes.js';
import {
  RUN_PROGRESS_AGENT_KEY,
  runProgressStorageKey
} from '../memory/runProgressNote.js';
import { getWorkspace } from '../workspace/workspaceState.js';
import { listConversations } from '../conversations/conversationStore.js';
import type { ConversationMeta } from '@shared/types/chat';
import { realpathInsideWorkspace } from '../tools/sandbox.js';

/**
 * Reserved workspace-memory note key the agent maintains as a structured
 * run-progress scratchpad. Surfaced read-only in `<run_progress>` near the
 * turn so it survives reversible reduction / summarization. The harness
 * instructs the agent to keep it current via the `memory` tool.
 * @deprecated Use `RUN_PROGRESS_AGENT_KEY` from `runProgressNote.ts`.
 */
export const RUN_PROGRESS_NOTE_KEY = RUN_PROGRESS_AGENT_KEY;
/** Cap on the run-progress body folded into the runtime tail. */
const RUN_PROGRESS_MAX_CHARS = 2_000;

const TOP_LEVEL_LIMIT = 60;

/**
 * Lists the top-level entries of the run's pinned workspace. When
 * `workspacePath` is omitted (legacy single-workspace path), falls
 * back to the globally active workspace — preserves prior behaviour.
 */
async function workspaceTopLevel(workspacePath?: string): Promise<string> {
  let path: string | null;
  let label: string | null;
  if (workspacePath) {
    path = workspacePath;
    label = basename(workspacePath) || workspacePath;
  } else {
    const ws = await getWorkspace();
    path = ws.path;
    label = ws.label;
  }
  if (!path) return '(no workspace selected)';
  const displayPath = redactUserHomeInPath(path);
  let entries: import('node:fs').Dirent[];
  try {
    entries = await fs.readdir(path, { withFileTypes: true });
  } catch {
    return `(workspace ${displayPath} unreachable)`;
  }
  const lines = entries
    .filter((e) => !['node_modules', '.git', 'dist', 'out', '.next'].includes(e.name))
    .slice(0, TOP_LEVEL_LIMIT)
    .map((e) => (e.isDirectory() ? `[D] ${e.name}/` : `[F] ${e.name}`));
  return `Workspace: ${displayPath}\nLabel: ${label}\n\nTop-level entries:\n${lines.join('\n')}`;
}

export interface ContextEnvelopes {
  workspaceXml: string;
  memoryXml: string;
  metaRulesXml: string;
  /**
   * `<session_context>` — session-level hints (conversation title,
   * prior-turn count, last model used) that don't belong in the
   * workspace listing but anchor the current turn in its conversation.
   * Populated from the `ConversationMeta` cached by
   * `conversationStore.listConversations()` when a `conversationId`
   * is supplied to `refreshEnvelopes`; populated with an explicit
   * "(none — first turn of a fresh conversation)" body otherwise so
   * the agent can distinguish "genuinely fresh" from "looped-empty
   * memory" (see screenshots §4 regression).
   */
  sessionXml: string;
  /**
   * `<prior_conversations>` — compact directory of OTHER conversations
   * the user has had with the agent (excluding the active one). Each
   * row carries the conversation id, sanitized title (which the host
   * derived from the first user prompt — already a topical hint),
   * relative updatedAt, persisted event count, and last model used.
   * The body explicitly tells the agent it cannot see the full
   * transcript here — it must call the `recall` tool to read one.
   *
   * Bounded to `PRIOR_CONVERSATIONS_LIMIT` rows (most-recent first)
   * so the envelope never grows past a few hundred chars regardless
   * of conversation-index size.
   */
  priorConversationsXml: string;
  /**
   * `<run_progress>` — the agent-maintained structured progress note
   * (`RUN_PROGRESS_NOTE_KEY` workspace memory). Empty string when no note
   * exists yet. Surfaced near the turn so the agent's own running state
   * survives reversible reduction / summarization.
   */
  runProgressXml: string;
}

/**
 * Builds the `<session_context>` body from the in-memory conversation
 * index. No disk I/O — `listConversations()` returns a snapshot of the
 * cached array so this is microsecond-cheap. On any failure path we
 * fall back to the "fresh conversation" body rather than throwing, so
 * a transient index read error can never take down a live turn.
 *
 * `conversationsList` is an optional pre-fetched cross-workspace list.
 * `buildContextEnvelope` passes a single shared list so this helper
 * and `priorConversationsBody` don't both round-trip
 * `listConversations()` (audit fix B4 — they were two separate awaits
 * in `Promise.all`, each cloning the full index).
 */
async function sessionContextBody(
  conversationId: string | undefined,
  conversationsList?: readonly ConversationMeta[]
): Promise<string> {
  if (!conversationId) return '(none — first turn of a fresh conversation)';
  try {
    const list = conversationsList ?? (await listConversations());
    const meta = list.find((c) => c.id === conversationId);
    if (!meta) return '(none — first turn of a fresh conversation)';
    const titleLine = meta.title && meta.title !== 'New conversation'
      ? `Conversation: "${meta.title}"`
      : 'Conversation: (untitled — title will be derived from first prompt)';
    const turnsLine = `Prior turns persisted: ${meta.eventCount}`;
    const modelLine = meta.lastProviderId && meta.lastModelId
      ? `Last model: ${meta.lastProviderId}/${meta.lastModelId}`
      : 'Last model: (none yet)';
    return `${titleLine}\n${turnsLine}\n${modelLine}`;
  } catch {
    // Distinguish a transient lookup failure from a genuinely fresh
    // conversation. The former is a host-side issue (e.g. a corrupt
    // conversation index entry, a denied stat); collapsing it onto the
    // "fresh" body would tell the model to ignore replayed history,
    // which is exactly the wrong instruction. Surfacing the failure
    // explicitly lets the model lean on its replayed messages instead.
    return '(session lookup failed — treat the replayed message history above as the authoritative source for this conversation)';
  }
}

/** Cap on rows surfaced in `<prior_conversations>`. Tuned low so the
 *  envelope stays cheap; the agent can call `recall` with `action:'list'`
 *  for the full dock conversation list when it actually needs it. */
const PRIOR_CONVERSATIONS_LIMIT = 5;

/** Stable ISO timestamp for prior-conversation rows (prompt-cache safe). */
function formatUpdatedAtIso(updatedAt: number): string {
  return new Date(updatedAt).toISOString();
}

/**
 * Builds the `<prior_conversations>` body from the in-memory index.
 * Excludes the active conversation (handled separately by
 * `<session_context>`) and caps the row count. Returns the
 * "(none yet)" placeholder when the user has no other conversations
 * — keeps the envelope shape uniform so the agent can distinguish
 * "no prior sessions" from "envelope missing".
 *
 * Scoped to the run's `workspaceId` so cross-workspace conversations
 * never leak into the orchestrator's view. Without this filter, a run
 * in workspace A would see workspace B's titles and could try to
 * `recall` them — both an information-bleed surface and a confusion
 * surface for the model.
 */
async function priorConversationsBody(
  activeId: string | undefined,
  workspaceId: string | undefined,
  /**
   * Optional pre-fetched cross-workspace list. When supplied this
   * helper does the workspace-id filter in-process instead of
   * re-awaiting `listConversations(workspaceId)` (audit fix B4 —
   * shares one fetch with `sessionContextBody`). When omitted it
   * falls back to the prior shape so direct callers / tests still
   * work unchanged.
   */
  conversationsList?: readonly ConversationMeta[]
): Promise<string> {
  try {
    const list = conversationsList
      ? (typeof workspaceId === 'string'
        ? conversationsList.filter((m) => m.workspaceId === workspaceId)
        : conversationsList)
      : await listConversations(workspaceId);
    const others = list.filter((m) => m.id !== activeId);
    if (others.length === 0) {
      return '(none yet — this is the user\'s first conversation in this workspace)';
    }
    const top = others.slice(0, PRIOR_CONVERSATIONS_LIMIT);
    const rows = top.map((m) => {
      const title = m.title && m.title !== 'New conversation'
        ? `"${m.title}"`
        : '(untitled)';
      const model = m.lastProviderId && m.lastModelId
        ? ` | ${m.lastProviderId}/${m.lastModelId}`
        : '';
      return `- id=${m.id} | ${title} | ${formatUpdatedAtIso(m.updatedAt)} | ${m.eventCount} events${model}`;
    });
    const more = others.length > top.length
      ? `\n(${others.length - top.length} older conversation${others.length - top.length === 1 ? '' : 's'} not shown — call \`recall\` with \`action: 'list'\` for the full set.)`
      : '';
    // No inline guidance copy here — the harness "Context, Memory &
    // Research" §A explicitly tells the agent to call `recall` for
    // bodies of these conversations. Keeping this envelope to a tight
    // directory listing avoids duplicating that rule on every turn.
    return `${rows.join('\n')}${more}`;
  } catch {
    return '(none yet — this is the user\'s first conversation in this workspace)';
  }
}

export async function buildContextEnvelope(
  userPrompt: string,
  conversationId?: string,
  /**
   * Run-pinned workspace path. When supplied, `<workspace_context>`
   * lists the run's pinned folder rather than the globally-active
   * one, and memory retrieval is scoped to it. Falls back to the
   * active workspace when omitted (legacy single-workspace path).
   */
  workspacePath?: string,
  /**
   * Run-pinned workspace id. Filters `<prior_conversations>` to the
   * run's own workspace so sibling-workspace titles never leak into
   * the orchestrator's view.
   */
  workspaceId?: string
): Promise<ContextEnvelopes> {
  // Fetch the cross-workspace conversation list once and share it between
  // `sessionContextBody` and `priorConversationsBody`. A transient failure
  // resolves to `undefined` so each helper falls back to its own catch path.
  const sharedListPromise = listConversations().catch(() => undefined);
  const runProgressPromise =
    workspacePath && conversationId
      ? readWorkspaceNote(runProgressStorageKey(conversationId), workspacePath).catch(
          () => null
        )
      : Promise.resolve(null);
  const [topLevel, mem, conversationsList, runProgressNote] = await Promise.all([
    workspaceTopLevel(workspacePath),
    retrieveRelevantMemory(userPrompt, undefined, workspacePath),
    sharedListPromise,
    runProgressPromise
  ]);
  const [sessionBody, priorBody] = await Promise.all([
    sessionContextBody(conversationId, conversationsList),
    priorConversationsBody(conversationId, workspaceId, conversationsList)
  ]);

  // Empty-state copy: distinguishes "no keyword match" from "fresh
  // session" so the model stops ignoring its replayed message history.
  // The harness ("Context, Memory & Research") explains the rule in
  // detail, so this copy can stay short.
  const memoryBody =
    mem.notes.length === 0
      ? '(no persistent notes matched this query — relevance miss, not a freshness signal. Prior turns above remain visible.)'
      : mem.notes
        .map(
          (n) =>
            `## ${n.scope}: ${n.key}\n${n.content.trim().slice(0, 2000)}`
        )
        .join('\n\n');

  const runProgressBody =
    runProgressNote && runProgressNote.content.trim().length > 0
      ? runProgressNote.content.trim().slice(0, RUN_PROGRESS_MAX_CHARS)
      : '';

  return {
    workspaceXml: getStableWorkspaceXml(workspaceId, workspacePath, topLevel),
    sessionXml: wrapXml('session_context', sessionBody),
    priorConversationsXml: wrapXml('prior_conversations', priorBody),
    memoryXml: wrapXml('recent_memory', memoryBody),
    metaRulesXml: wrapXml('meta_rules', mem.metaRules.trim()),
    runProgressXml: runProgressBody.length > 0 ? wrapXml('run_progress', runProgressBody) : ''
  };
}

/** Fingerprint-gated workspace XML — reuse identical listing strings. */
const workspaceXmlByFingerprint = new Map<string, { fingerprint: string; workspaceXml: string }>();
/**
 * Cap on distinct-workspace entries. Keyed by workspace, so the natural size is
 * "workspaces touched this session", but a long-lived process that visits many
 * workspaces would otherwise grow unbounded — the design guarantees all caches
 * are bounded. Insertion-ordered LRU: a hit refreshes recency, overflow evicts
 * the least-recently-used workspace.
 */
const WORKSPACE_XML_CACHE_MAX = 16;

function workspaceCacheKey(workspaceId: string | undefined, workspacePath: string | undefined): string {
  return `${workspaceId ?? ''}\u0000${workspacePath ?? ''}`;
}

function fingerprintWorkspaceBody(body: string): string {
  return createHash('sha256').update(body).digest('hex');
}

/**
 * Returns a stable `<workspace_context>` wrapper. Skips re-wrapping when
 * the top-level listing body is byte-identical to the last value for this
 * workspace — keeps the prompt prefix stable for provider-side caching.
 */
function getStableWorkspaceXml(
  workspaceId: string | undefined,
  workspacePath: string | undefined,
  topLevelBody: string
): string {
  const key = workspaceCacheKey(workspaceId, workspacePath);
  const fingerprint = fingerprintWorkspaceBody(topLevelBody);
  const hit = workspaceXmlByFingerprint.get(key);
  if (hit && hit.fingerprint === fingerprint) {
    // Refresh recency (re-insert moves the key to the end of iteration order).
    workspaceXmlByFingerprint.delete(key);
    workspaceXmlByFingerprint.set(key, hit);
    return hit.workspaceXml;
  }
  const workspaceXml = wrapXml('workspace_context', topLevelBody);
  workspaceXmlByFingerprint.delete(key);
  workspaceXmlByFingerprint.set(key, { fingerprint, workspaceXml });
  if (workspaceXmlByFingerprint.size > WORKSPACE_XML_CACHE_MAX) {
    const oldest = workspaceXmlByFingerprint.keys().next().value;
    if (oldest !== undefined) workspaceXmlByFingerprint.delete(oldest);
  }
  return workspaceXml;
}

const ENVELOPE_TTL_MS = 3_000;
/**
 * Cap on simultaneously-cached envelopes. Sized for "a handful of
 * parallel runs across at most a handful of workspaces" — the common
 * shape under multi-session use. A single global slot (the previous
 * shape) caused two parallel runs in different workspaces to alternate-
 * evict each other, so every refresh became a miss. Correctness was
 * never in question (the cache key includes `workspaceId`); only
 * cross-workspace cache hit rate suffered.
 */
const ENVELOPE_CACHE_MAX = 8;

/** Rolling-query fingerprint cap — long enough to distinguish
 *  materially different memory-retrieval prompts without bloating
 *  the LRU entry. */
const ENVELOPE_QUERY_FP_MAX = 600;

function envelopeQueryFingerprint(query: string): string {
  const trimmed = query.trim();
  if (trimmed.length <= ENVELOPE_QUERY_FP_MAX) return trimmed;
  return trimmed.slice(0, ENVELOPE_QUERY_FP_MAX);
}

interface EnvelopeCacheEntry {
  expiresAt: number;
  value: ContextEnvelopes;
  /** Last `query` used to build this entry — compared on hit so a
   *  changed rolling query within the same conv/workspace cannot
   *  serve stale memory retrieval (audit B1 follow-up). */
  queryFingerprint: string;
}

/**
 * Insertion-order Map used as a tiny LRU. On hit we re-insert the entry
 * so it floats to the tail; eviction drops the head (oldest) entry once
 * the size exceeds `ENVELOPE_CACHE_MAX`. The key is
 * (conversationId, workspaceId, workspacePath); `query` is NOT part of
 * the key (audit B1) but IS compared via `queryFingerprint` on hit.
 * Parts are NUL-separated (`\u0000`) to defeat concatenation collisions.
 */
const envelopeCache = new Map<string, EnvelopeCacheEntry>();

export async function refreshEnvelopes(
  query: string,
  conversationId?: string,
  workspacePath?: string,
  workspaceId?: string
): Promise<ContextEnvelopes> {
  const now = Date.now();
  // Cache key is (conversationId, workspaceId, workspacePath) — NOT
  // `query`. Audit fix B1: the per-iteration `query` mutates on every
  // direct-tool round (see `runLoop.ts` — it folds in the
  // latest tool args), so including it collapsed the hit rate of this
  // cache to effectively zero across a run. The envelopes that care
  // about `query` (memory retrieval) still get a fresh value on every
  // miss within the 3-second TTL. Pre-audit behavior was "miss on
  // every iteration" which is what we get when we drop `query`; the
  // new behavior is "hit within TTL when the workspace/conversation
  // is unchanged", which is a strict improvement.
  //
  // `workspacePath` is kept in addition to `workspaceId` so a workspace
  // move (same id, different absolute path) cannot serve a stale
  // `<workspace_context>` listing or memory-retrieval result computed
  // against the old root. Defense in depth.
  const key =
    `${conversationId ?? ''}\u0000` +
    `${workspaceId ?? ''}\u0000` +
    `${workspacePath ?? ''}`;
  const queryFingerprint = envelopeQueryFingerprint(query);
  const hit = envelopeCache.get(key);
  if (hit && hit.expiresAt > now && hit.queryFingerprint === queryFingerprint) {
    // Re-insert so this key is now the tail (most-recently-used). The
    // delete + set pair is cheap on Map and is the canonical insertion-
    // order LRU trick.
    envelopeCache.delete(key);
    envelopeCache.set(key, hit);
    return hit.value;
  }
  if (hit) envelopeCache.delete(key); // expired or stale query — drop
  const value = await buildContextEnvelope(query, conversationId, workspacePath, workspaceId);
  envelopeCache.set(key, {
    expiresAt: now + ENVELOPE_TTL_MS,
    value,
    queryFingerprint
  });
  // Evict the oldest (head) entry once over capacity. A `for..of` over
  // a Map yields keys in insertion order, so the first iteration's key
  // is the LRU entry.
  if (envelopeCache.size > ENVELOPE_CACHE_MAX) {
    for (const oldestKey of envelopeCache.keys()) {
      envelopeCache.delete(oldestKey);
      break;
    }
  }
  return value;
}

/**
 * Test-only escape hatch — clears the LRU between cases so per-test
 * state doesn't leak. Not exported through any production module.
 */
export function __resetEnvelopeCacheForTests(): void {
  envelopeCache.clear();
}

/**
 * Per-file inlining ceiling. Files larger than this are sliced and
 * suffixed with the `INLINE_TRUNCATION_MARKER` so the worker knows the
 * tail is missing. Sized to keep a 20-file attachment inline batch under ~640 KB
 * total even on small models without aborting the run.
 */
const INLINE_FILE_CHAR_CAP = 32_000;

/**
 * Visible marker appended INSIDE the `<file>` body when content was
 * sliced. Without this, the model may treat partial content as if it
 * were the whole file and summarize / cite content that does NOT
 * exist beyond the cap — a small but real hallucination surface.
 *
 * The marker explicitly tells the worker how to recover: emit a
 * targeted `read` call with a line range so the relevant tail can be
 * inlined surgically instead of paying the full-file cost. The
 * counts (`shown` / `total`) help the worker pick a sensible line
 * range without overshooting and re-paying for the full file.
 */
function buildInlineTruncationMarker(shownChars: number, totalChars: number): string {
  return (
    `\n<!-- TRUNCATED: file exceeds the inline cap. shown=${shownChars} chars / total=${totalChars} chars. ` +
    'Call `read` with a specific line range if you need the rest. -->'
  );
}

/**
 * Per-call shared body cache. Caller-owned; lifecycle is one prompt-assembly
 * batch (one map passed across parallel `inlineFiles` probes so
 * N concurrent reads of file X cause 1 disk read, not N). When
 * omitted the inlining runs uncached — preserves the legacy single-
 * worker call-site shape used by direct callers and tests.
 *
 * The cache key is the **realpath** of the file (post-sandbox check),
 * not the user-supplied relative path. Two specs that reference the
 * same file via different relative spellings (`./core/agent.py` vs
 * `core/agent.py`) still share the read. The cached value is the
 * fully-rendered `<file path="…">…</file>` body keyed off the
 * caller-facing relative path inside a wrapper so attribute escaping
 * stays correct per call.
 *
 * Cache hits are NEVER negative — a path that failed the sandbox check
 * or the FS read is re-attempted per worker so a transient `EBUSY` or
 * an evolving sandbox state can't latch a failure for the whole round.
 * Negative caching saves microseconds at the cost of correctness; the
 * round-scoped cache exists for the heavy-load happy path.
 *
 * Audit fix A2.
 */
export type InlineFileCache = Map<string, string>;

/** Mint a fresh per-round inlining cache. Mirrors the contract caller
 *  side without forcing them to import the Map shape. */
export function createInlineFileCache(): InlineFileCache {
  return new Map();
}

/**
 * Concurrency cap for the bounded probe pool inside `inlineFiles`
 * (review finding H9). Without bounding, an N-file attachment batch runs
 * `realpath` + `readFile` strictly serially — N × wall-clock latency
 * even when the OS could have served them concurrently. The cap of 4
 * keeps FS pressure modest while still cutting typical multi-file latency.
 *
 * Result order is preserved by writing each task's output into a
 * pre-sized slot indexed by input position, then joining at the end.
 */
const INLINE_FILES_CONCURRENCY = 4;

/**
 * Marker emitted in place of a file body when the run's abort signal
 * fires before / during the inline read. Surfaces the abort to
 * downstream prompt assembly so the model never sees a truncated body
 * masquerading as a complete file. Audit fix 2026-08-P2-1 / 13-P2-1.
 */
const INLINE_ABORTED_MARKER = '(aborted before read)';

export async function inlineFiles(
  workspacePath: string,
  files: string[],
  cache?: InlineFileCache,
  /**
   * Audit fix 2026-08-P2-1 / 13-P2-1: optional abort signal threaded
   * from the orchestrator run's `AbortController`. When the signal
   * fires (user aborts mid-prompt-assembly with a 50-file attachment
   * spec), every still-pending slot collapses to a cheap aborted
   * marker INSIDE the existing concurrent-pool drain — no new
   * fs.readFile is started, in-flight reads still drain (Node's
   * `fs.readFile` doesn't take an `AbortSignal` directly, but the
   * run's outer `AbortController` will reject anyway,
   * so the worst case is one extra file finishing on a 32 KB cap).
   *
   * Optional so direct callers / tests retain the legacy two-arg
   * shape.
   */
  signal?: AbortSignal
): Promise<string> {
  if (files.length === 0) return '';
  // Pre-sized output slots so concurrent workers can write directly
  // by index without contending on a shared array push order. Each
  // slot ends as exactly one rendered `<file ...>` block (or the
  // matching error / sandbox-escape variant).
  const slots = new Array<string>(files.length);

  const inlineOne = async (rel: string, idx: number): Promise<void> => {
    // `rel` is workspace-relative but can contain characters that would
    // otherwise close the `path="…"` attribute (`"`, `&`, `<`, `>`).
    // Same story for `msg` on the error branch. Both are escaped through
    // `escapeXmlAttr` so the envelope stays well-formed for every path.
    const safeRel = escapeXmlAttr(rel);
    // Audit fix 2026-08-P2-1 / 13-P2-1: bail out immediately if the
    // run's abort fired before this slot started. The pool's outer
    // workers also re-check below so an abort mid-batch collapses
    // every queued slot to the aborted marker without any FS I/O.
    if (signal?.aborted) {
      slots[idx] = `<file path="${safeRel}" error="${INLINE_ABORTED_MARKER}" />`;
      return;
    }
    // PRIVACY BOUNDARY — route every path through the workspace sandbox
    // BEFORE touching the filesystem. `ChatSendInput.attachments` is
    // renderer-controlled; without this guard, `path.join(workspacePath,
    // "../../.ssh/id_rsa")` would escape the workspace, read the file,
    // and inline its contents into the user prompt sent to the
    // configured LLM provider — a direct violation of the "never
    // transmit local file contents … to external servers" Prime
    // Directive. Escapes emit a marker instead of reading.
    //
    // We use `realpathInsideWorkspace` (NOT the cheaper lexical
    // `resolveInsideWorkspace`) so a workspace-rooted symlink whose
    // target lives outside the sandbox — e.g. `vendor -> /etc` — is
    // rejected even when the lexical path looks safe. Without the
    // realpath check, an attached `vendor/passwd` file would be read
    // through the symlink and shipped outbound to the configured LLM
    // provider. Same helper used by `read.tool.ts` for the same
    // operation; lexical-only checks were a defense-in-depth gap that
    // contradicted the Prime-Directive comment above.
    let abs: string;
    try {
      abs = await realpathInsideWorkspace(workspacePath, rel);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      slots[idx] = `<file path="${safeRel}" error="${escapeXmlAttr(msg)}" />`;
      return;
    }
    // Round-scoped cache hit — parallel tool calls reading file X in the
    // same iteration all share one disk read. The
    // cached value is the bare body (truncation marker included),
    // re-wrapped here under the caller's actual `<file path="…">`
    // attribute so an escape mismatch can never round-trip.
    if (cache) {
      const cached = cache.get(abs);
      if (cached !== undefined) {
        slots[idx] = `<file path="${safeRel}">\n${cached}\n</file>`;
        return;
      }
    }
    // Re-check the abort right before the FS read so a signal that
    // fired during the realpath await still collapses this slot
    // before paying the file-read cost.
    if (signal?.aborted) {
      slots[idx] = `<file path="${safeRel}" error="${INLINE_ABORTED_MARKER}" />`;
      return;
    }
    try {
      // Pass the signal into `fs.readFile` so a long read of a large
      // file (think a 5 MB attached log) gets cancelled the moment
      // the orchestrator aborts the run.
      const txt = await fs.readFile(abs, { encoding: 'utf8', signal });
      // Surface the truncation explicitly. Silent slicing was a
      // hallucination surface: workers reported on content they
      // never actually saw. The marker lives INSIDE the `<file>`
      // body so it travels with the content through every later
      // pass (envelope rendering, prompt assembly, transport).
      const body = txt.length > INLINE_FILE_CHAR_CAP
        ? txt.slice(0, INLINE_FILE_CHAR_CAP) +
        buildInlineTruncationMarker(INLINE_FILE_CHAR_CAP, txt.length)
        : txt;
      if (cache) cache.set(abs, body);
      slots[idx] = `<file path="${safeRel}">\n${body}\n</file>`;
    } catch (err: unknown) {
      // `fs.readFile` rejects with `AbortError` when the signal
      // fires mid-read; we surface that distinctly so the caller's
      // log stream can tell "the run aborted" from "the file is
      // unreadable".
      if ((err as NodeJS.ErrnoException)?.name === 'AbortError') {
        slots[idx] = `<file path="${safeRel}" error="${INLINE_ABORTED_MARKER}" />`;
        return;
      }
      const msg = err instanceof Error ? err.message : String(err);
      slots[idx] = `<file path="${safeRel}" error="${escapeXmlAttr(msg)}" />`;
    }
  };

  // Bounded-concurrency worker pool (review finding H9). Each worker
  // pulls the next index off a shared cursor and runs `inlineOne`
  // until the cursor is past the end. The pool size is
  // `min(concurrency, files.length)` so a 1-file batch still parallelizes
  // exactly one worker, not `INLINE_FILES_CONCURRENCY` idle ones.
  let cursor = 0;
  const worker = async (): Promise<void> => {
    while (cursor < files.length) {
      // Fast-fail every queued index once the run aborts. Each worker
      // still finishes its CURRENT in-flight `inlineOne`; subsequent
      // pulls write the aborted marker without touching the FS.
      if (signal?.aborted) {
        const idx = cursor++;
        const rel = files[idx];
        if (rel !== undefined) {
          slots[idx] = `<file path="${escapeXmlAttr(rel)}" error="${INLINE_ABORTED_MARKER}" />`;
        }
        continue;
      }
      const idx = cursor++;
      await inlineOne(files[idx]!, idx);
    }
  };
  const workerCount = Math.min(INLINE_FILES_CONCURRENCY, files.length);
  const workers: Promise<void>[] = [];
  for (let w = 0; w < workerCount; w++) workers.push(worker());
  await Promise.all(workers);

  return slots.join('\n\n');
}

/**
 * Count `<file>` blocks whose bodies were successfully inlined (opening
 * tag is `<file path="…">\n`, not the self-closing `error="…"` form).
 * Used by the P2b structural verifier: zero tool results is acceptable
 * when the host already inlined at least one assigned file.
 */
export function countSuccessfulInlines(filesBlock: string): number {
  if (!filesBlock.trim()) return 0;
  const matches = filesBlock.match(/<file path="[^"]+">\n/g);
  return matches?.length ?? 0;
}
