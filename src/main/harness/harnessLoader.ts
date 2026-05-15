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

import { listTools } from '../tools/registry.js';
import { wrapXml } from '../orchestrator/envelope/index.js';
import { ORCHESTRATOR_TOOLS } from '../tools/policy/index.js';
import { MAX_NUDGES_PER_RUN } from '../orchestrator/loop/handleNoToolNoDelegate.js';
import {
  BASE_BACKOFF_MS,
  MAX_BACKOFF_MS,
  MAX_DELEGATION_BAD_ROUNDS,
  MAX_PARALLEL_SUBAGENTS,
  MAX_SELF_CORRECTION_ATTEMPTS,
  MAX_TOOL_OUTPUT_CHARS,
  MAX_TOTAL_ITERATIONS,
  STREAM_INACTIVITY_TIMEOUT_MS,
  SUBAGENT_MAX_ITERATIONS,
  SUBAGENT_WRAPUP_ITER
} from '@shared/constants.js';

import primeDirectives from './00-prime-directives.md?raw';
import orchestrationLoop from './01-orchestration-loop.md?raw';
import contextAndMemory from './02-context-and-memory.md?raw';
import continuousLearning from './03-continuous-learning.md?raw';
import subagentPrompt from './04-subagent-prompt.md?raw';

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
  //   - `MAX_NUDGES_PER_RUN` lives next to its consumer in
  //     `handleNoToolNoDelegate.ts`; we re-export the live value here
  //     rather than redeclaring it so a future tuning bump cannot
  //     drift from the actual enforced cap.
  return wrapXml(
    'runtime_limits',
    [
      `MAX_TOTAL_ITERATIONS=${MAX_TOTAL_ITERATIONS}`,
      `MAX_SELF_CORRECTION_ATTEMPTS=${MAX_SELF_CORRECTION_ATTEMPTS}`,
      `MAX_DELEGATION_BAD_ROUNDS=${MAX_DELEGATION_BAD_ROUNDS}`,
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
      `STREAM_INACTIVITY_TIMEOUT_MS=${STREAM_INACTIVITY_TIMEOUT_MS}`
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

export function buildSubagentSystemPrompt(opts: {
  task: string;
  allowedTools: string[];
  runState?: string;
}): string {
  // Sort the allowlist so semantically equal sets ([read,bash] ==
  // [bash,read]) produce one cache entry, not two. NUL separator
  // defeats concatenation collisions between any tool name with
  // the task body even when the task happens to contain `,`.
  const sortedTools = [...opts.allowedTools].sort();
  const key = `${sortedTools.join(',')}\u0000${opts.task}`;
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
  const runStateBlock = opts.runState ? `\n\n---\n\n${opts.runState}` : '';
  return wrapXml('system_instructions', `${staticBody}${runStateBlock}`);
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
