/**
 * Harness loader. Reads markdown that constitutes Agent V's natural-language
 * operating system and assembles the system prompt. Per-tool briefs come from
 * registry `Tool` objects so schemas and prose stay aligned.
 *
 * Always-on sections (`HARNESS_PREFIX_SECTION_IDS`) go into the cached
 * `<system_instructions>` system slot every turn. Reference material lives in
 * on-demand "context packs" (`CONTEXT_PACK_IDS`): a short catalogue advertises
 * them in the prefix, and the model loads a pack itself via the `context` tool
 * when it needs it — keeping the static prefix lean and the per-turn token
 * cost low without sacrificing recoverability.
 */

import { listTools } from '../tools/registry.js';
import { wrapXml } from '../orchestrator/envelope/index.js';
import { AGENT_TOOLS } from '../tools/policy/index.js';
import type { HarnessSectionId } from '@shared/types/harness.js';
import { HARNESS_PREFIX_SECTION_IDS } from '@shared/types/harness.js';
import {
  BASE_BACKOFF_MS,
  IMPLICIT_FINISH_MIN_CHARS,
  IMPLICIT_FINISH_MIN_SENTENCE_CHARS,
  MAX_BACKOFF_MS,
  MAX_SELF_CORRECTION_ATTEMPTS,
  MAX_TOOL_OUTPUT_CHARS,
  MAX_TOTAL_ITERATIONS,
  STREAM_INACTIVITY_TIMEOUT_MS
} from '@shared/constants.js';

import orchestratorCore from './00-orchestrator-core.md?raw';
import contextLearning from './01-context-learning.md?raw';
import dynamicLoop from './05-dynamic-loop.md?raw';
import { readHarnessOverride } from './harnessOverrides.js';
import {
  assertContextPacksPresent,
  buildContextPackCatalogue,
  invalidateContextPacks,
  readBundledContextPack,
  warmContextPacks
} from './contextPacks.js';

/** Bundled bodies for the always-on prefix sections (00 / 01 / 05). */
const BUNDLED_PREFIX_BODIES: Record<(typeof HARNESS_PREFIX_SECTION_IDS)[number], string> = {
  'orchestrator-core': orchestratorCore,
  'context-learning': contextLearning,
  'dynamic-loop': dynamicLoop
};

function isPrefixSectionId(
  id: HarnessSectionId
): id is (typeof HARNESS_PREFIX_SECTION_IDS)[number] {
  return (HARNESS_PREFIX_SECTION_IDS as readonly string[]).includes(id);
}

/** Bundled body for any editable section — prefix sections here, packs delegate. */
export function readBundledHarnessSection(sectionId: HarnessSectionId): string {
  return isPrefixSectionId(sectionId)
    ? BUNDLED_PREFIX_BODIES[sectionId]
    : readBundledContextPack(sectionId);
}

async function resolvePrefixBody(
  sectionId: (typeof HARNESS_PREFIX_SECTION_IDS)[number]
): Promise<string> {
  const override = await readHarnessOverride(sectionId);
  if (override !== null && override.trim().length > 0) {
    return override;
  }
  return BUNDLED_PREFIX_BODIES[sectionId];
}

let prefixBodiesCache: Record<(typeof HARNESS_PREFIX_SECTION_IDS)[number], string> | null = null;

async function loadPrefixBodies(): Promise<
  Record<(typeof HARNESS_PREFIX_SECTION_IDS)[number], string>
> {
  if (prefixBodiesCache) return prefixBodiesCache;
  const entries = await Promise.all(
    HARNESS_PREFIX_SECTION_IDS.map(async (id) => [id, await resolvePrefixBody(id)] as const)
  );
  prefixBodiesCache = Object.fromEntries(entries) as Record<
    (typeof HARNESS_PREFIX_SECTION_IDS)[number],
    string
  >;
  return prefixBodiesCache;
}

export function invalidateHarnessPromptCache(): void {
  agentPromptCache = null;
  prefixBodiesCache = null;
  invalidateContextPacks();
}

function assertHarnessMarkdownPresent(): void {
  for (const id of HARNESS_PREFIX_SECTION_IDS) {
    const body = BUNDLED_PREFIX_BODIES[id];
    if (typeof body !== 'string' || body.trim().length === 0) {
      throw new Error(
        `harness boot: section "${id}" missing or empty (Vite ?raw import failed or file unparseable)`
      );
    }
  }
  assertContextPacksPresent();
}

function buildRuntimeLimitsBlock(): string {
  return wrapXml(
    'runtime_limits',
    [
      `MAX_TOTAL_ITERATIONS=${MAX_TOTAL_ITERATIONS}`,
      `MAX_SELF_CORRECTION_ATTEMPTS=${MAX_SELF_CORRECTION_ATTEMPTS}`,
      `BASE_BACKOFF_MS=${BASE_BACKOFF_MS}`,
      `MAX_BACKOFF_MS=${MAX_BACKOFF_MS}`,
      `STREAM_INACTIVITY_TIMEOUT_MS=${STREAM_INACTIVITY_TIMEOUT_MS}`,
      `MAX_TOOL_OUTPUT_CHARS=${MAX_TOOL_OUTPUT_CHARS}`,
      `IMPLICIT_FINISH_MIN_CHARS=${IMPLICIT_FINISH_MIN_CHARS}`,
      `IMPLICIT_FINISH_MIN_SENTENCE_CHARS=${IMPLICIT_FINISH_MIN_SENTENCE_CHARS}`,
      'RUN_TOKEN_BUDGET=optional (Settings → Agent behavior → Run limits)',
      'RUN_WALL_CLOCK_BUDGET=optional (Settings → Agent behavior → Run limits)',
      'CONTEXT_COMPACTION=optional (Settings → Agent behavior → Context management)'
    ].join('\n')
  );
}

function buildAgentToolCatalogue(): string {
  const directNames = new Set<string>(AGENT_TOOLS);
  const tools = listTools().filter((t) => directNames.has(t.name));
  const briefs = tools.map((t) => t.briefMarkdown.trim()).join('\n\n---\n\n');
  return (
    `# Your Tools (callable via \`tool_calls\`)\n\n` +
    `Full JSON schemas are on the wire \`tools[]\` array. Plain-English briefs:\n\n` +
    briefs +
    `\n\nUse tools when the task needs action. You may answer in plain prose when that fully satisfies the user.\n` +
    `- \`finish\` and \`ask_user\` are explicit ways to end a run.\n` +
    `- Substantive prose without tools also ends the run when it fully answers the user.`
  );
}

let agentPromptCache: string | null = null;

export function assertHarnessBoot(): void {
  assertHarnessMarkdownPresent();
  const prompt = buildOrchestratorSystemPrompt();
  if (!prompt.includes('<system_instructions>')) {
    throw new Error('harness boot: agent prompt missing <system_instructions>');
  }
  if (!prompt.includes('<runtime_limits>')) {
    throw new Error('harness boot: agent prompt missing <runtime_limits>');
  }
  if (!prompt.includes(`MAX_TOTAL_ITERATIONS=${MAX_TOTAL_ITERATIONS}`)) {
    throw new Error('harness boot: runtime_limits drift from constants.ts');
  }
  if (!prompt.includes('# On-Demand Context Packs')) {
    throw new Error('harness boot: context pack catalogue missing from system prompt');
  }
}

/** System prompt for Agent V (single dynamic agent). */
export function buildOrchestratorSystemPrompt(): string {
  if (agentPromptCache !== null) return agentPromptCache;
  const bodies = prefixBodiesCache ?? BUNDLED_PREFIX_BODIES;
  const sections = HARNESS_PREFIX_SECTION_IDS.map((id) => bodies[id]).join('\n\n---\n\n');
  const built = wrapXml(
    'system_instructions',
    `${sections}\n\n---\n\n${buildRuntimeLimitsBlock()}\n\n---\n\n` +
      `${buildAgentToolCatalogue()}\n\n---\n\n${buildContextPackCatalogue()}`
  );
  agentPromptCache = built;
  return built;
}

export function __resetOrchestratorPromptCacheForTests(): void {
  invalidateHarnessPromptCache();
}

/** Load user overrides into memory. Call at app boot and after harness edits. */
export async function warmHarnessOverrides(): Promise<void> {
  prefixBodiesCache = null;
  agentPromptCache = null;
  await Promise.all([loadPrefixBodies(), warmContextPacks()]);
}
