/**
 * Harness loader. Reads the `.md` files that constitute Agent V's natural-
 * language operating system and assembles them into the system prompt
 * delivered to the LLM. The per-tool briefs are pulled from the `Tool`
 * objects directly so they stay in sync with the schemas the model sees.
 *
 * The harness was consolidated from 9 files to 5 (audit pass): the loop,
 * delegation, and self-correction docs collapse into one orchestration
 * file; context management, memory, and research modes collapse into a
 * single context-and-memory file; security bounds fold into prime
 * directives. Runtime numerical limits (`MAX_*` constants) are injected
 * into the harness body so the prose can never drift from the actual
 * code in `@shared/constants.ts`.
 *
 * IMPORTANT: We embed the markdown files at build time via Vite's `?raw`
 * import so that the bundled main process does not depend on filesystem
 * paths in production.
 */

import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { listTools } from '../tools/registry.js';
import { wrapXml } from '../orchestrator/envelope/index.js';
import { escapeXmlBody } from '../orchestrator/envelope/escapeXmlBody.js';
import { ORCHESTRATOR_TOOLS } from '../tools/policy/index.js';
import {
  BASE_BACKOFF_MS,
  CONTEXT_SUMMARY_DEFAULT_KEEP_RECENT_TURNS,
  CONTEXT_SUMMARY_DEFAULT_MAX_RETRIES,
  CONTEXT_SUMMARY_DEFAULT_TRIGGER_RATIO,
  CONTEXT_SUMMARY_MAX_FINAL_CHARS,
  CONTEXT_SUMMARY_MIN_MESSAGES_TO_SUMMARIZE,
  CONTEXT_SUMMARY_OVERRIDE_FILENAME,
  MAX_BACKOFF_MS,
  MAX_DELEGATION_BAD_ROUNDS,
  MAX_NUDGES_PER_RUN,
  MAX_PARALLEL_SUBAGENTS,
  MAX_PER_TASK_BAD_STREAK,
  MAX_SELF_CORRECTION_ATTEMPTS,
  MAX_TOOL_OUTPUT_CHARS,
  MAX_TOTAL_ITERATIONS,
  STREAM_INACTIVITY_TIMEOUT_MS,
  SUBAGENT_MAX_ITERATIONS,
  SUBAGENT_WRAPUP_ITER,
  WORKSPACE_DOTDIR
} from '@shared/constants.js';
import { logger } from '../logging/logger.js';

import primeDirectives from './00-prime-directives.md?raw';
import orchestrationLoop from './01-orchestration-loop.md?raw';
import contextAndMemory from './02-context-and-memory.md?raw';
import continuousLearning from './03-continuous-learning.md?raw';
import subagentPrompt from './04-subagent-prompt.md?raw';
import contextSummarizer from './05-context-summarizer.md?raw';

const log = logger.child('harness/loader');

const ORCHESTRATOR_SECTIONS: ReadonlyArray<{ title: string; body: string }> = [
  { title: 'Prime Directives', body: primeDirectives },
  { title: 'Orchestration Loop, Delegation & Self-Correction', body: orchestrationLoop },
  { title: 'Context, Memory & Research', body: contextAndMemory },
  { title: 'Continuous Learning', body: continuousLearning }
];

/**
 * Render the runtime-limits envelope. Single source of truth for the
 * numbers the harness references — pulling them from `constants.ts`
 * means the prose in the markdown can never lie about the actual cap
 * the host enforces. Surfaced as a tagged data block so the model can
 * cite specific numbers without us having to template the markdown.
 */
function buildRuntimeLimitsBlock(): string {
  // Every counter the host enforces is surfaced here so the model has a
  // numeric handle for it inside `<run_state>`. Two counters were
  // historically opaque to the model:
  //
  //   - `MAX_DELEGATION_BAD_ROUNDS` was a magic literal in
  //     `handleDelegates.ts`; promoting it to `@shared/constants.ts`
  //     makes the harness §C statement "the host enforces three
  //     parallel strike counters" honest at the prompt layer too.
  //
  //   - `MAX_NUDGES_PER_RUN` was promoted from
  //     `handleNoToolNoDelegate.ts` into `@shared/constants.ts` (T1-5)
  //     so every `MAX_*` knob has a single home. The matching consumer
  //     re-exports the shared symbol for backward compatibility.
  return wrapXml(
    'runtime_limits',
    [
      `MAX_TOTAL_ITERATIONS=${MAX_TOTAL_ITERATIONS}`,
      `MAX_SELF_CORRECTION_ATTEMPTS=${MAX_SELF_CORRECTION_ATTEMPTS}`,
      `MAX_DELEGATION_BAD_ROUNDS=${MAX_DELEGATION_BAD_ROUNDS}`,
      // Per-task soft pivot signal (T1-2). Surfaced in
      // `<run_state>.failing_tasks` when any decomposition's bad-verdict
      // streak crosses `MAX_PER_TASK_BAD_STREAK - 1`. A pure observability
      // signal — does NOT halt the run; the round-level
      // `MAX_DELEGATION_BAD_ROUNDS` halt remains the only delegation halt.
      `MAX_PER_TASK_BAD_STREAK=${MAX_PER_TASK_BAD_STREAK}`,
      `MAX_PARALLEL_SUBAGENTS=${MAX_PARALLEL_SUBAGENTS}`,
      // `MAX_ORCHESTRATOR_SPIN_NUDGES` was removed in the
      // subtraction-pass: the host no longer enforces a spin nudge or
      // halt path. The model still sees `<run_state>.spin_signature_hot`
      // and is told (harness §C "Don't re-survey what you've already
      // seen") to pivot when it surfaces. The cache banner already
      // tells the model the call is a no-op from the SECOND identical
      // invocation onward — strictly earlier than the dropped detector
      // ever fired.
      `MAX_NUDGES_PER_RUN=${MAX_NUDGES_PER_RUN}`,
      // Backoff constants — referenced by name in the §C "Backoff"
      // prose of `01-orchestration-loop.md`. Kept in `<runtime_limits>`
      // alongside the other caps so a future tuning bump propagates
      // into the harness without manual prose edits.
      `BASE_BACKOFF_MS=${BASE_BACKOFF_MS}`,
      `MAX_BACKOFF_MS=${MAX_BACKOFF_MS}`,
      // Stream-inactivity timeout — surfaced so the model has a concrete
      // number for "how long can a quiet provider stall before the host
      // retries". The §C "Backoff" prose says transport flakes are
      // retried with exponential backoff; this is the dwell time before
      // the backoff ladder even starts.
      `STREAM_INACTIVITY_TIMEOUT_MS=${STREAM_INACTIVITY_TIMEOUT_MS}`,
      // Context-summarization defaults — surfaced so the orchestrator
      // can self-reason about when the host will compress its
      // `messages[]`. The actual values in effect at run time may be
      // OVERRIDDEN by `AppSettings.contextSummary` (global) or
      // `AppSettings.ui.contextSummaryByWorkspace[wsId]` (workspace);
      // these are the build-time defaults that apply in absence of any
      // user override. The §E "Compressed History" prose in
      // `02-context-and-memory.md` references these by name.
      `CONTEXT_SUMMARY_DEFAULT_TRIGGER_RATIO=${CONTEXT_SUMMARY_DEFAULT_TRIGGER_RATIO}`,
      `CONTEXT_SUMMARY_DEFAULT_KEEP_RECENT_TURNS=${CONTEXT_SUMMARY_DEFAULT_KEEP_RECENT_TURNS}`,
      `CONTEXT_SUMMARY_MIN_MESSAGES_TO_SUMMARIZE=${CONTEXT_SUMMARY_MIN_MESSAGES_TO_SUMMARIZE}`
    ].join('\n')
  );
}

/**
 * Strip the JSON-schema fenced sample from a tool's brief markdown.
 * Delegated-tool briefs are never callable from the orchestrator, so the
 * raw `{ "name": "...", "arguments": ... }` example is just noise that
 * tempts a model to try a direct call. We keep the WHAT/HOW/WHY/WHEN
 * prose and drop only the schema fence.
 *
 * The brief format is `### Tool: \`name\`\n\n**WHAT…**\n…\n\n```json\n…\n````,
 * with the schema fenced as `json`. Removing one fenced JSON block is a
 * surgical edit; unrelated `bash` / `tsx` fences in the prose stay.
 *
 * Audit A-13 — KNOWN LIMITATION: this strip is dialect-agnostic and
 * removes **every** ` ```json ` fence in a brief. If a future tool
 * brief adds a non-final illustrative JSON example (e.g. an expected
 * RESULT shape block) it WILL be stripped too. Mitigations if you
 * need a JSON example to survive into the delegated catalogue:
 *   1. Fence it as ` ```json5 ` / ` ```jsonc ` / ` ```javascript ` —
 *      the regex below matches ` ```json ` followed by a newline only.
 *   2. Or use a non-JSON illustrative form (TS interface inside a
 *      ` ```ts ` fence is the convention used elsewhere in the
 *      catalogue).
 *   3. Or refactor this helper to strip ONLY the trailing schema
 *      fence (anchor on end-of-string or match the position relative
 *      to the WHAT/HOW/WHY/WHEN structure).
 */
function stripSchemaFence(brief: string): string {
  // Strip EVERY ```json fence (some briefs — `edit`, `search` — carry
  // multiple examples). Global regex; leaves non-json fences (`bash`,
  // `tsx`, etc.) untouched.
  return brief
    .replace(/```json\n[\s\S]*?\n```/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function buildOrchestratorToolCatalogue(): string {
  const all = listTools();
  const directNames = new Set<string>(ORCHESTRATOR_TOOLS);
  const direct = all.filter((t) => directNames.has(t.name));
  const delegated = all.filter((t) => !directNames.has(t.name));

  const directBriefs = direct.map((t) => t.briefMarkdown).join('\n\n');
  const delegatedBriefs = delegated
    .map((t) => stripSchemaFence(t.briefMarkdown))
    .join('\n\n');

  const directSection =
    `# Direct Tools (callable by you)\n\n` +
    `These tools are present in your function-calling schema. Invoke them ` +
    `via the standard \`tool_calls\` mechanism.\n\n${directBriefs}`;

  const delegatedSection =
    `# Delegated Tools (NOT in your schema — use \`<delegate>\`)\n\n` +
    `The following tools are NOT exposed to you directly. Any attempt to ` +
    `call them via \`tool_calls\` will be rejected by the host. To use them, ` +
    `emit a \`<delegate id="..." task="..." files="..." tools="edit,bash" />\` ` +
    `directive in your assistant text. The host parses every \`<delegate>\` ` +
    `directive, spawns a real ephemeral sub-agent with a fresh context, and ` +
    `feeds the verified \`<result>\` back into your conversation. ` +
    `**\`<delegate>\` IS wired up — emitting it WILL spawn a real sub-agent.**\n\n` +
    `${delegatedBriefs}`;

  return `${directSection}\n\n---\n\n${delegatedSection}`;
}

/**
 * Memoized orchestrator system prompt.
 *
 * The whole prompt is purely a function of `import`-time inputs: the
 * markdown bodies are bundled via Vite `?raw`, the runtime-limits
 * numbers are `@shared/constants.ts` constants, and the tool
 * catalogue is derived from the static tool registry. Pre-fix, every
 * iteration of every run rebuilt the same ~80kb string from scratch
 * — the per-call cost is small but the same string is the input to
 * the LLM transport on every assistant turn, so it adds up under
 * multi-iteration runs. Audit fix B6: build it once on first call,
 * cache the result, and serve subsequent calls from the cache.
 *
 * Tests that mutate the tool registry between cases call
 * `__resetOrchestratorPromptCacheForTests` to invalidate the cache.
 */
let orchestratorPromptCache: string | null = null;

/** System prompt for the orchestrator (top-level Agent V). */
export function buildOrchestratorSystemPrompt(): string {
  if (orchestratorPromptCache !== null) return orchestratorPromptCache;
  const sections = ORCHESTRATOR_SECTIONS.map((s) => s.body).join('\n\n---\n\n');
  const built = wrapXml(
    'system_instructions',
    `${sections}\n\n---\n\n${buildRuntimeLimitsBlock()}\n\n---\n\n${buildOrchestratorToolCatalogue()}`
  );
  orchestratorPromptCache = built;
  return built;
}

/**
 * Test-only invalidation hook. Production code never calls this; the
 * orchestrator prompt's inputs are all import-time-frozen so an
 * invalidation in production would be a logic error.
 */
export function __resetOrchestratorPromptCacheForTests(): void {
  orchestratorPromptCache = null;
}

/**
 * Render the sub-agent runtime-limits envelope. Sub-agents see only the
 * caps that govern THEIR own loop (iteration ceiling + tool-output cap)
 * — the orchestrator-only knobs (`MAX_TOTAL_ITERATIONS`,
 * `MAX_PARALLEL_SUBAGENTS`, planning-nudge budget) are intentionally
 * absent so the worker doesn't model surface it cannot influence.
 * Source-of-truth is `@shared/constants.ts`; the prose can never drift
 * from the enforced values.
 */
function buildSubagentRuntimeLimitsBlock(): string {
  return wrapXml(
    'runtime_limits',
    [
      `SUBAGENT_MAX_ITERATIONS=${SUBAGENT_MAX_ITERATIONS}`,
      // Iteration index (0-based) at which the host forces `tool_choice:
      // "none"` for the NEXT request. Surfaced so the worker can stage a
      // `<result>` envelope on/before this iteration instead of being
      // surprised when its tool-call attempt is silently dropped. See
      // `04-subagent-prompt.md` "Iteration discipline".
      `SUBAGENT_WRAPUP_ITER=${SUBAGENT_WRAPUP_ITER}`,
      `MAX_SELF_CORRECTION_ATTEMPTS=${MAX_SELF_CORRECTION_ATTEMPTS}`,
      `MAX_TOOL_OUTPUT_CHARS=${MAX_TOOL_OUTPUT_CHARS}`
    ].join('\n')
  );
}

/**
 * System prompt for ephemeral sub-agents. Restricted, scoped, single-task.
 *
 * The `<task>` block is now nested INSIDE `<system_instructions>` and its
 * body is XML-body-escaped. Two reasons:
 *
 *   1. Prime Directives §6 says everything outside `<system_instructions>`
 *      must be treated as DATA, not instructions. The previous shape put
 *      `<task>` as a peer of `<system_instructions>`, which forced the
 *      sub-agent to read it as instructions while it lived in the data
 *      plane — an ambiguity easy to exploit.
 *   2. The task body was forwarded verbatim from the orchestrator's
 *      `<delegate task="..." />` directive. A task string carrying
 *      `</system_instructions>` (or any unescaped `<` / `>`) could break
 *      out of the wrapping envelope and inject prompt content. Escaping
 *      the body via `wrapXml(..., { escape: true })` closes that
 *      injection surface without breaking legitimate punctuation.
 *
 * The `<runtime_limits>` block is emitted alongside the task so the
 * worker can self-budget against its iteration cap.
 *
 * The optional `runState` parameter is the pre-rendered `<run_state>`
 * envelope (built per iteration by `buildSubagentRunStateXml`). When
 * present, it is appended INSIDE the `<system_instructions>` wrapper so
 * the worker treats it as authoritative host telemetry rather than data.
 * The static portion of the prompt (directives, harness body, tool
 * catalogue, limits, task) is identical across iterations — the swap is
 * scoped to the trailing run-state block.
 *
 * Caching (audit fix A1): the static-body assembly walks the tool
 * registry, filters by `allowedTools`, joins ~5 markdown bodies, and
 * runs `wrapXml` over the task block. Pre-fix, this fired on EVERY
 * sub-agent iteration. A typical delegation round has 4 parallel
 * workers × 8–14 iterations each → ~30–60 redundant rebuilds of a
 * string whose inputs are pinned for the worker's whole lifetime
 * (`task` + `allowedTools`). We memoize the static body keyed on
 * those two inputs and assemble the final prompt as
 * `wrapXml('system_instructions', staticBody + runStateAppendix)`
 * per iteration, which is the only piece that actually changes.
 *
 * Cache bound: `SUBAGENT_BODY_CACHE_MAX` entries (insertion-order
 * LRU, same pattern as `envelopeCache`). Tasks vary per delegation
 * directive so the natural shape is "one entry per concurrent
 * worker family" — 32 is generous for an interactive desktop run
 * and trivial in memory (~32×~80 KB strings).
 */
const SUBAGENT_BODY_CACHE_MAX = 32;
const subagentBodyCache = new Map<string, string>();

/**
 * Pure assembly of the per-worker invariant body. Walked once per
 * `(task, allowedTools)` shape and reused across all iterations.
 */
function buildSubagentStaticBody(task: string, allowedTools: string[]): string {
  const allowed = listTools().filter((t) => allowedTools.includes(t.name));
  const briefs = allowed.map((t) => t.briefMarkdown).join('\n\n');
  const taskBlock = wrapXml('task', task, undefined, { escape: true });
  const limits = buildSubagentRuntimeLimitsBlock();
  return (
    `${primeDirectives}\n\n---\n\n${subagentPrompt}\n\n---\n\n` +
    `# Tool Catalogue (restricted)\n\n${briefs}\n\n---\n\n${limits}\n\n---\n\n${taskBlock}`
  );
}

/**
 * Canonicalize the task string for cache-key purposes (review finding
 * M11). Two semantically-equal tasks differing only in casing /
 * whitespace ("Read foo.ts" vs "read  foo.ts") used to produce two
 * cache entries — the bounded `SUBAGENT_BODY_CACHE_MAX` saves us from
 * a leak, but the hit rate suffered.
 *
 * Cheap canonicalization: lowercase + trim + collapse interior runs
 * of whitespace to a single space. Applied ONLY to the cache key —
 * the body is still built from the raw `opts.task` so the worker
 * sees its task text verbatim. The trade-off: two canonically-equal
 * tasks share the first one's body. Bounded by intent — the model
 * almost never relies on whitespace / casing as semantic signal in
 * sub-agent tasks.
 */
function canonicalizeTaskForCacheKey(task: string): string {
  return task.trim().replace(/\s+/g, ' ').toLowerCase();
}

export function buildSubagentSystemPrompt(opts: {
  task: string;
  allowedTools: string[];
  runState?: string;
  /**
   * Optional `<host_environment>` envelope (real-time host snapshot —
   * see `buildHostEnvironmentXml`). Appended OUTSIDE the cache key
   * because the timestamp inside changes every call. Ordering mirrors
   * the orchestrator's system prompt: harness body → host environment
   * → run state, so a `bash` worker on Windows reads "what OS am I on"
   * before "what iteration am I on". Omitted entirely when undefined,
   * keeping the existing fixture-based tests unchanged.
   */
  hostEnvironment?: string;
}): string {
  // Sort the allowlist so semantically equal sets ([read,bash] ==
  // [bash,read]) produce one cache entry, not two. NUL separator
  // defeats concatenation collisions between any tool name with
  // the task body even when the task happens to contain `,`.
  // Task canonicalization (M11) further improves hit rate without
  // affecting body content — see `canonicalizeTaskForCacheKey`.
  const sortedTools = [...opts.allowedTools].sort();
  const key = `${sortedTools.join(',')}\u0000${canonicalizeTaskForCacheKey(opts.task)}`;
  let staticBody = subagentBodyCache.get(key);
  if (staticBody === undefined) {
    staticBody = buildSubagentStaticBody(opts.task, sortedTools);
    subagentBodyCache.set(key, staticBody);
    // Insertion-order LRU eviction: drop the oldest entry when the
    // bound is exceeded. Mirrors the eviction pattern in
    // `contextManager.refreshEnvelopes`.
    if (subagentBodyCache.size > SUBAGENT_BODY_CACHE_MAX) {
      for (const oldestKey of subagentBodyCache.keys()) {
        subagentBodyCache.delete(oldestKey);
        break;
      }
    }
  } else {
    // Re-insert so the freshest hit floats to the tail (canonical
    // Map-as-LRU trick — see `envelopeCache` for the same pattern).
    subagentBodyCache.delete(key);
    subagentBodyCache.set(key, staticBody);
  }
  // Dynamic per-iteration suffix. Both blocks are appended OUTSIDE the
  // static-body cache so a fresh timestamp / counter snapshot never
  // poisons a future cache hit. Order matches the orchestrator's:
  // host environment (slow-changing) before run state (per-iteration).
  const hostEnvironmentBlock = opts.hostEnvironment
    ? `\n\n---\n\n${opts.hostEnvironment}`
    : '';
  const runStateBlock = opts.runState ? `\n\n---\n\n${opts.runState}` : '';
  return wrapXml(
    'system_instructions',
    `${staticBody}${hostEnvironmentBlock}${runStateBlock}`
  );
}

/**
 * Test-only invalidation hook. Production never calls this; the cache
 * inputs are pinned for the worker's lifetime so a production
 * invalidation would be a logic error. Tests that mutate the tool
 * registry between cases call this to avoid cross-case leakage.
 */
export function __resetSubagentPromptCacheForTests(): void {
  subagentBodyCache.clear();
}

// ────────────────────────────────────────────────────────────────────
// Context-summarizer system prompt
// ────────────────────────────────────────────────────────────────────

/**
 * Cached map of `<workspacePath>` → resolved bundled-vs-override body.
 *
 * The bundled `05-context-summarizer.md` is embedded via `?raw` and
 * never changes at runtime. Per-workspace overrides at
 * `<workspacePath>/.vyotiq/context-summarizer.md` ARE filesystem-
 * resident and the user can edit them between summarizations, so
 * the cache entry is keyed on `(workspacePath, mtimeMs)` to bust
 * automatically when the override file is touched.
 *
 * Bound (`SUMMARIZER_OVERRIDE_CACHE_MAX = 16`) so even a session that
 * cycles through dozens of workspaces keeps memory predictable; same
 * insertion-order LRU eviction pattern as `subagentBodyCache`.
 */
interface SummarizerOverrideCacheEntry {
  body: string;
  /** True ⇒ workspace override was found and used. False ⇒ bundled
   *  body returned. The renderer surfaces this in the Inspector. */
  fromOverride: boolean;
  /** mtime of the override file at cache time. `undefined` when no
   *  override file existed. Used to invalidate when the user edits
   *  the file between summarizations. */
  mtimeMs?: number;
}

const SUMMARIZER_OVERRIDE_CACHE_MAX = 16;
const summarizerOverrideCache = new Map<string, SummarizerOverrideCacheEntry>();

/**
 * Resolve the summarizer body for a given workspace.
 *
 *   1. Look for `<workspacePath>/.vyotiq/context-summarizer.md`. If it
 *      exists and is non-empty after trim, return it as the body.
 *   2. Otherwise return the bundled `05-context-summarizer.md`.
 *
 * Returns `{ body, fromOverride }` so the Inspector can surface a
 * badge when the workspace is using a custom prompt. The result is
 * cached per workspace path; the cache invalidates when the override
 * file's mtime advances (or it's deleted between calls).
 *
 * Workspace-less callers (no workspace pinned to the run) skip the
 * override probe entirely and always get the bundled body.
 *
 * Errors are swallowed — an unreadable override file (permission
 * flap, ENOENT mid-read) falls back to the bundled body and logs a
 * `debug` line so production stays quiet.
 */
async function resolveSummarizerBody(
  workspacePath: string | undefined
): Promise<{ body: string; fromOverride: boolean }> {
  const bundled = { body: contextSummarizer, fromOverride: false as const };
  if (!workspacePath || workspacePath.length === 0) return bundled;
  const overridePath = join(
    workspacePath,
    WORKSPACE_DOTDIR,
    CONTEXT_SUMMARY_OVERRIDE_FILENAME
  );
  // mtime probe: cheap stat. If the file isn't there, the cache may
  // still hold an entry from a previous session (where the file
  // existed) — invalidate by deleting the cache entry so we don't
  // serve stale override bodies after the user removed the file.
  let mtimeMs: number | undefined;
  try {
    const st = await fs.stat(overridePath);
    mtimeMs = st.mtimeMs;
  } catch {
    mtimeMs = undefined;
  }
  const cached = summarizerOverrideCache.get(workspacePath);
  if (cached && cached.mtimeMs === mtimeMs) {
    // Re-insert so the freshest hit floats to the tail (LRU).
    summarizerOverrideCache.delete(workspacePath);
    summarizerOverrideCache.set(workspacePath, cached);
    return { body: cached.body, fromOverride: cached.fromOverride };
  }
  // Either no cache entry, or mtime advanced — re-read.
  let resolved: SummarizerOverrideCacheEntry;
  if (mtimeMs === undefined) {
    resolved = { body: bundled.body, fromOverride: false };
  } else {
    try {
      const raw = await fs.readFile(overridePath, 'utf8');
      const trimmed = raw.trim();
      if (trimmed.length === 0) {
        // Empty file → fall back to bundled but DO cache the mtime so
        // we don't re-read on every iteration. The user explicitly
        // chose to "blank" the override; honoring it would mean
        // sending an empty system prompt to the summarizer (worse
        // than the bundled body), so we surface it as bundled with
        // a soft warning.
        log.warn('summarizer override file is empty; using bundled', {
          path: overridePath
        });
        resolved = { body: bundled.body, fromOverride: false, mtimeMs };
      } else {
        // Defense in depth (review finding H8). The bundled summarizer
        // body is trusted (built-time `?raw` import), but a workspace-
        // local override file is a Prime-Directives §6 boundary
        // crossing: an external process — a malicious npm postinstall,
        // a project scaffolder writing dotfiles, a dev-tool artifact
        // dump — could plant content there that includes literal
        // `</system_instructions>` (or any other tag the host wraps
        // around `body`) and inject arbitrary instructions into the
        // summarizer LLM call. We XML-escape the override body before
        // caching so:
        //
        //   1. `<` / `>` / `&` inside the override are neutralized —
        //      a literal `</system_instructions>` becomes
        //      `&lt;/system_instructions&gt;` in the prompt and
        //      cannot close the wrapper.
        //   2. Markdown prose flows through unchanged in normal use
        //      (markdown almost never contains raw XML metacharacters);
        //      only crafted XML payloads are reshaped.
        //   3. The escape is applied ONCE at cache time so the
        //      steady-state per-summarization cost is unchanged.
        //
        // Bundled `body` is NOT escaped — the harness markdown
        // intentionally contains `<delegate>`, `<result>`, etc. in
        // prose that the model is trained to read.
        resolved = { body: escapeXmlBody(raw), fromOverride: true, mtimeMs };
      }
    } catch (err) {
      log.debug('summarizer override read failed; using bundled', {
        path: overridePath,
        err
      });
      resolved = { body: bundled.body, fromOverride: false, mtimeMs };
    }
  }
  summarizerOverrideCache.set(workspacePath, resolved);
  if (summarizerOverrideCache.size > SUMMARIZER_OVERRIDE_CACHE_MAX) {
    for (const oldest of summarizerOverrideCache.keys()) {
      summarizerOverrideCache.delete(oldest);
      break;
    }
  }
  return { body: resolved.body, fromOverride: resolved.fromOverride };
}

/**
 * Render the `<runtime_limits>` envelope the summarizer LLM receives.
 *
 * The summarizer's only hard limit is `MAX_FINAL_CHARS` — the harness
 * (§D point 3) instructs it to truncate sections in priority order
 * when the projected output would exceed this value. We also surface
 * the global retry budget so the summarizer is aware its output may
 * be re-issued under transport flakes (matters for any future
 * "deterministic output" clause it could lean on).
 */
function buildSummarizerRuntimeLimitsBlock(): string {
  return wrapXml(
    'runtime_limits',
    [
      `MAX_FINAL_CHARS=${CONTEXT_SUMMARY_MAX_FINAL_CHARS}`,
      `MAX_RETRIES=${CONTEXT_SUMMARY_DEFAULT_MAX_RETRIES}`
    ].join('\n')
  );
}

/**
 * System prompt for the dedicated context-summarizer LLM call.
 *
 * Composition (in order):
 *   1. Prime Directives (`00-prime-directives.md`) — the summarizer is
 *      still bound by the privacy / containment / "never invent paths"
 *      rules.
 *   2. The summarizer-specific harness body — bundled
 *      `05-context-summarizer.md` OR a workspace override at
 *      `<workspace>/.vyotiq/context-summarizer.md` when present and
 *      non-empty.
 *   3. `<runtime_limits>` block (final-chars cap + retry budget).
 *
 * The whole block is wrapped in `<system_instructions>` per the
 * Prime Directives §6 boundary rule. The summarizer's USER message
 * (the actual messages-to-compress payload) is constructed by
 * `streamSummary.ts` and is XML-body-escaped there — same defense
 * the orchestrator's user-envelope path uses.
 *
 * Returns `{ prompt, fromOverride }`. The renderer surfaces the
 * `fromOverride` flag in the Inspector via a small "Using workspace
 * override" badge so the user can tell whether their `.vyotiq/
 * context-summarizer.md` is in effect for this workspace.
 *
 * Async because the workspace-override probe touches the filesystem.
 * Cache hits are microsecond-cheap; the first call per workspace
 * pays one `stat` + one `readFile` only when an override exists.
 */
export async function buildSummarizerSystemPrompt(opts: {
  workspacePath?: string;
}): Promise<{ prompt: string; fromOverride: boolean }> {
  const { body, fromOverride } = await resolveSummarizerBody(opts.workspacePath);
  const sections = [
    primeDirectives,
    body,
    buildSummarizerRuntimeLimitsBlock()
  ].join('\n\n---\n\n');
  return {
    prompt: wrapXml('system_instructions', sections),
    fromOverride
  };
}

/**
 * Test-only cache reset. Production never calls this; the override
 * cache invalidates itself on mtime advance, so a production
 * invalidation would only mask a bug in that pathway.
 */
export function __resetSummarizerOverrideCacheForTests(): void {
  summarizerOverrideCache.clear();
}

/**
 * Test-only readout of the bundled summarizer body. Lets the
 * harness-level summarizer-prompt tests assert that
 * `buildSummarizerSystemPrompt` falls back to this exact string when
 * no workspace override exists, without re-importing the `?raw`
 * module from the test side (Vite's `?raw` only resolves under the
 * main-bundle config).
 */
export function __getBundledSummarizerBodyForTests(): string {
  return contextSummarizer;
}
