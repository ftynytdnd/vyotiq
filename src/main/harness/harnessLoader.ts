/**
 * Harness loader. Reads the `.md` files that constitute Agent V's natural-
 * language operating system and assembles them into the system prompt
 * delivered to the LLM. The per-tool briefs are pulled from the `Tool`
 * objects directly so they stay in sync with the schemas the model sees.
 *
 * The harness is three markdown files: `00-orchestrator-core.md`,
 * `01-context-learning.md`, and `02-subagent-prompt.md`. Runtime numerical
 * limits (`MAX_*` constants) are injected
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
import {
  BASE_BACKOFF_MS,
  MAX_BACKOFF_MS,
  MAX_DELEGATION_BAD_ROUNDS,
  DEFAULT_DELEGATE_CONCURRENCY,
  HOST_DELEGATE_CONCURRENCY_CEILING,
  MAX_PER_TASK_BAD_STREAK,
  MAX_SELF_CORRECTION_ATTEMPTS,
  MAX_TOOL_OUTPUT_CHARS,
  MAX_TOTAL_ITERATIONS,
  STREAM_INACTIVITY_TIMEOUT_MS,
  SUBAGENT_MAX_ITERATIONS,
  SUBAGENT_RUN_TIMEOUT_MS,
  SUBAGENT_WRAPUP_ITER
} from '@shared/constants.js';

import orchestratorCore from './00-orchestrator-core.md?raw';
import contextLearning from './01-context-learning.md?raw';
import subagentPrompt from './02-subagent-prompt.md?raw';

const ORCHESTRATOR_SECTIONS: ReadonlyArray<{ title: string; body: string }> = [
  { title: 'Orchestrator Core', body: orchestratorCore },
  { title: 'Context, Memory & Continuous Learning', body: contextLearning }
];

/** Bundled harness bodies validated at boot — missing/empty fails loud. */
const BOOTSTRAP_HARNESS_MARKDOWN: ReadonlyArray<{ file: string; body: string }> = [
  { file: '00-orchestrator-core.md', body: orchestratorCore },
  { file: '01-context-learning.md', body: contextLearning },
  { file: '02-subagent-prompt.md', body: subagentPrompt }
];

function assertHarnessMarkdownPresent(): void {
  for (const { file, body } of BOOTSTRAP_HARNESS_MARKDOWN) {
    if (typeof body !== 'string' || body.trim().length === 0) {
      throw new Error(
        `harness boot: ${file} missing or empty (Vite ?raw import failed or file unparseable)`
      );
    }
  }
}

/** Heading that starts the orchestrator-only worked example in prime directives. */
const PRIME_DIRECTIVES_WORKED_EXAMPLE_HEADING =
  '### Worked example — codebase analysis';

/**
 * Prime directives with the orchestrator-only worked example removed.
 * Sub-agents must not receive concrete example paths that weak models
 * copy into `files=` or `read` targets.
 */
export function primeDirectivesWithoutOrchestratorExample(body: string): string {
  const start = body.indexOf(PRIME_DIRECTIVES_WORKED_EXAMPLE_HEADING);
  if (start === -1) return body;
  const rest = body.slice(start + PRIME_DIRECTIVES_WORKED_EXAMPLE_HEADING.length);
  const nextHeading = rest.search(/\n### /);
  const end =
    nextHeading === -1 ? body.length : start + PRIME_DIRECTIVES_WORKED_EXAMPLE_HEADING.length + nextHeading;
  const before = body.slice(0, start).trimEnd();
  const after = body.slice(end).replace(/^\n+/, '');
  if (after.length === 0) return before;
  if (before.length === 0) return after;
  return `${before}\n\n${after}`;
}

const primeDirectivesForSubagent = primeDirectivesWithoutOrchestratorExample(orchestratorCore);

/**
 * Render the runtime-limits envelope. Single source of truth for the
 * numbers the harness references — pulling them from `constants.ts`
 * means the prose in the markdown can never lie about the actual cap
 * the host enforces. Surfaced as a tagged data block so the model can
 * cite specific numbers without us having to template the markdown.
 */
function buildRuntimeLimitsBlock(): string {
  return wrapXml(
    'runtime_limits',
    [
      `MAX_TOTAL_ITERATIONS=${MAX_TOTAL_ITERATIONS}`,
      `MAX_SELF_CORRECTION_ATTEMPTS=${MAX_SELF_CORRECTION_ATTEMPTS}`,
      `MAX_DELEGATION_BAD_ROUNDS=${MAX_DELEGATION_BAD_ROUNDS}`,
      `MAX_PER_TASK_BAD_STREAK=${MAX_PER_TASK_BAD_STREAK}`,
      `DEFAULT_DELEGATE_CONCURRENCY=${DEFAULT_DELEGATE_CONCURRENCY}`,
      `HOST_DELEGATE_CONCURRENCY_CEILING=${HOST_DELEGATE_CONCURRENCY_CEILING}`,
      `BASE_BACKOFF_MS=${BASE_BACKOFF_MS}`,
      `MAX_BACKOFF_MS=${MAX_BACKOFF_MS}`,
      `STREAM_INACTIVITY_TIMEOUT_MS=${STREAM_INACTIVITY_TIMEOUT_MS}`,
      `SUBAGENT_RUN_TIMEOUT_MS=${SUBAGENT_RUN_TIMEOUT_MS}`,
      '',
      '# Delegation guidance (not host-enforced caps)',
      'Recommended delegates per orchestrator turn: 8-12 for broad analysis/planning;',
      'prefer 4-8 module-scoped read delegates; never exceed 12 in one turn;',
      '≤6 delegates per turn for fix/edit phases after synthesis.',
      'Each delegate reads AND analyzes its files in ONE task — never run a',
      'separate "read all" round followed by an "analyze all" round over the',
      'same files. Phase 2 = targeted hotspots only, never a second full sweep.'
    ].join('\n')
  );
}

/** Compact grant matrix for delegate-only tools (full briefs go to sub-agents). */
const DELEGATED_TOOL_MATRIX: ReadonlyArray<{
  name: string;
  hint: string;
  typicalGrants: readonly (readonly string[])[];
}> = [
  {
    name: 'read',
    hint: 'Read file contents; supports line ranges.',
    typicalGrants: [['read'], ['read', 'ls'], ['read', 'search']]
  },
  {
    name: 'edit',
    hint: 'Apply a unique `oldString` patch; pair with `read`.',
    typicalGrants: [['read', 'edit'], ['read', 'edit', 'bash']]
  },
  {
    name: 'bash',
    hint: 'Run shell in the workspace sandbox (non-destructive inspection or builds).',
    typicalGrants: [['bash'], ['read', 'bash']]
  },
  {
    name: 'search',
    hint: 'Ripgrep local workspace (`mode: local`).',
    typicalGrants: [['search'], ['read', 'search']]
  },
  {
    name: 'delete',
    hint: 'Delete a file with checkpoint snapshot.',
    typicalGrants: [['delete'], ['read', 'delete']]
  },
  {
    name: 'report',
    hint: 'Write a static HTML artifact under `.vyotiq/reports/`.',
    typicalGrants: [['report'], ['read', 'report']]
  }
];

function buildDelegatedToolMatrix(): string {
  const rows = DELEGATED_TOOL_MATRIX.map((row) => {
    const grants = row.typicalGrants.map((g) => `\`${JSON.stringify(g)}\``).join(', ');
    return `- **\`${row.name}\`** — ${row.hint} Typical \`tools\`: ${grants}.`;
  }).join('\n');

  return (
    `# Sub-agent Tools (grant these via \`delegate\`)\n\n` +
    `The tools below are NOT in your own schema — calling them directly is ` +
    `rejected by the host. Grant them to a sub-agent through the \`tools\` ` +
    `argument of a \`delegate\` call (for example \`"tools": ["read", "edit"]\`). ` +
    `The sub-agent executes them in a fresh, isolated context and returns a ` +
    `verified result. Omit \`tools\` to grant the read-only default allowlist ` +
    `(\`read\`, \`ls\`, \`search\`). Full tool briefs are included in the ` +
    `sub-agent prompt only.\n\n` +
    rows
  );
}

function buildOrchestratorToolCatalogue(): string {
  const all = listTools();
  const directNames = new Set<string>(ORCHESTRATOR_TOOLS);
  const direct = all.filter((t) => directNames.has(t.name));

  const directBriefs = direct.map((t) => t.briefMarkdown).join('\n\n');

  // All orchestrator tools — including `delegate`, `finish`, and
  // `ask_user` — are real, directly-callable function-calling tools.
  // A run should end by calling `finish` (deliver the answer and stop) or
  // `ask_user` (pause for a user reply). For simple greetings or clear
  // one-shot answers, reply in prose or call `finish` — do not explore
  // the workspace unless the user asked for work.
  const directSection =
    `# Your Tools (callable directly via \`tool_calls\`)\n\n` +
    `Every tool below is present in your function-calling schema — invoke ` +
    `it with \`tool_calls\` when the task needs action. You may answer in ` +
    `plain prose when that fully satisfies the user.\n\n` +
    `- \`delegate\` — spawn a real ephemeral sub-agent for ONE micro-task. ` +
    `Emit several \`delegate\` calls in the SAME turn to run sub-agents ` +
    `concurrently. This is how all real work (reading, editing, shell) gets ` +
    `done.\n` +
    `- \`ls\` / \`memory\` / \`recall\` — gather workspace structure, notes, ` +
    `and prior-conversation context.\n` +
    `- \`finish\` and \`ask_user\` are the ONLY ways to end a run. \`finish\` ` +
    `delivers your final, user-facing answer and stops the run; \`ask_user\` ` +
    `pauses for a clarifying reply. A run never ends by simply not calling a ` +
    `tool — you must declare the end explicitly.\n\n` +
    `${directBriefs}`;

  return `${directSection}\n\n---\n\n${buildDelegatedToolMatrix()}`;
}

/**
 * Memoized orchestrator system prompt.
 *
 * The whole prompt is purely a function of `import`-time inputs: the
 * markdown bodies are bundled via Vite `?raw`, the runtime-limits
 * numbers are `@shared/constants.ts` constants, and the tool
 * catalogue is derived from the static tool registry. Built once on
 * first call and cached for subsequent orchestrator turns.
 *
 * Tests that mutate the tool registry between cases call
 * `__resetOrchestratorPromptCacheForTests` to invalidate the cache.
 */
let orchestratorPromptCache: string | null = null;

/**
 * Synchronous boot guard — fails fast before IPC/window if harness
 * assembly or `<runtime_limits>` drift from `@shared/constants.ts`.
 */
export function assertHarnessBoot(): void {
  assertHarnessMarkdownPresent();
  const orch = buildOrchestratorSystemPrompt();
  if (!orch.includes('<system_instructions>')) {
    throw new Error('harness boot: orchestrator prompt missing <system_instructions>');
  }
  if (!orch.includes('<runtime_limits>')) {
    throw new Error('harness boot: orchestrator prompt missing <runtime_limits>');
  }
  if (!orch.includes(`MAX_TOTAL_ITERATIONS=${MAX_TOTAL_ITERATIONS}`)) {
    throw new Error('harness boot: orchestrator runtime_limits drift from constants.ts');
  }
  const sub = buildSubagentSystemPrompt({
    task: 'boot-check',
    allowedTools: ['read']
  });
  if (!sub.includes('<runtime_limits>')) {
    throw new Error('harness boot: sub-agent prompt missing <runtime_limits>');
  }
  if (!sub.includes(`SUBAGENT_MAX_ITERATIONS=${SUBAGENT_MAX_ITERATIONS}`)) {
    throw new Error('harness boot: sub-agent runtime_limits drift from constants.ts');
  }
}

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
 * `DEFAULT_DELEGATE_CONCURRENCY`, delegation strike budget) are intentionally
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
      // `02-subagent-prompt.md` "Iteration discipline".
      `SUBAGENT_WRAPUP_ITER=${SUBAGENT_WRAPUP_ITER}`,
      // Pool wall-clock cap — distinct from orchestrator
      // `STREAM_INACTIVITY_TIMEOUT_MS` (SSE idle between chunks).
      `SUBAGENT_RUN_TIMEOUT_MS=${SUBAGENT_RUN_TIMEOUT_MS}`,
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
 *      `delegate` tool `task` argument. A task string carrying
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
 * The static-body assembly (directives, harness, tool catalogue, limits,
 * task) is memoized per `(task, allowedTools)`; only the optional
 * `runState` appendix changes per iteration.
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
  const envelopeReminder =
    '## Required final envelope (repeat)\n\n' +
    'Your LAST action MUST be exactly one `<result>…</result>` block:\n\n' +
    '```\n' +
    '<result>\n' +
    '<status>success|partial|failed</status>\n' +
    '<summary>One sentence: what you did or attempted.</summary>\n' +
    '<details>\n' +
    '- Specific finding or change.\n' +
    '</details>\n' +
    '<artifacts>\n' +
    '- Path or symbol you produced/modified.\n' +
    '</artifacts>\n' +
    '</result>\n' +
    '```';
  return (
    `${primeDirectivesForSubagent}\n\n---\n\n${subagentPrompt}\n\n---\n\n` +
    `# Tool Catalogue (restricted)\n\n${briefs}\n\n---\n\n${limits}\n\n---\n\n${taskBlock}\n\n---\n\n${envelopeReminder}`
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
