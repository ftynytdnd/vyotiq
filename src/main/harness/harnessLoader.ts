/**
 * Harness loader. Reads markdown that constitutes Agent V's natural-language
 * operating system and assembles the system prompt. Per-tool briefs come from
 * registry `Tool` objects so schemas and prose stay aligned.
 */

import { listTools } from '../tools/registry.js';
import { wrapXml } from '../orchestrator/envelope/index.js';
import { AGENT_TOOLS } from '../tools/policy/index.js';
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
import deliverables from './02-deliverables.md?raw';
import staticExamples from './03-static-examples.md?raw';
import type { HarnessSectionId } from './harnessOverrides.js';
import { readHarnessOverride } from './harnessOverrides.js';

const BUNDLED_BODIES: Record<HarnessSectionId, string> = {
  'orchestrator-core': orchestratorCore,
  'context-learning': contextLearning,
  deliverables: deliverables,
  'static-examples': staticExamples
};

export function readBundledHarnessSection(sectionId: HarnessSectionId): string {
  return BUNDLED_BODIES[sectionId];
}

async function resolveSectionBody(sectionId: HarnessSectionId): Promise<string> {
  const override = await readHarnessOverride(sectionId);
  if (override !== null && override.trim().length > 0) {
    return override;
  }
  return BUNDLED_BODIES[sectionId];
}

let sectionBodiesCache: Record<HarnessSectionId, string> | null = null;

async function loadSectionBodies(): Promise<Record<HarnessSectionId, string>> {
  if (sectionBodiesCache) return sectionBodiesCache;
  const entries = await Promise.all(
    (Object.keys(BUNDLED_BODIES) as HarnessSectionId[]).map(async (id) => [
      id,
      await resolveSectionBody(id)
    ] as const)
  );
  sectionBodiesCache = Object.fromEntries(entries) as Record<HarnessSectionId, string>;
  return sectionBodiesCache;
}

export function invalidateHarnessPromptCache(): void {
  agentPromptCache = null;
  sectionBodiesCache = null;
}

const AGENT_SECTIONS: ReadonlyArray<{ title: string; id: HarnessSectionId }> = [
  { title: 'Agent Core', id: 'orchestrator-core' },
  { title: 'Context, Memory & Continuous Learning', id: 'context-learning' },
  { title: 'Deliverables — Markdown vs HTML Reports', id: 'deliverables' }
];

const BOOTSTRAP_HARNESS_MARKDOWN: ReadonlyArray<{ file: string; id: HarnessSectionId }> = [
  { file: '00-orchestrator-core.md', id: 'orchestrator-core' },
  { file: '01-context-learning.md', id: 'context-learning' },
  { file: '03-static-examples.md', id: 'static-examples' },
  { file: '02-deliverables.md', id: 'deliverables' }
];

function assertHarnessMarkdownPresent(): void {
  for (const { file, id } of BOOTSTRAP_HARNESS_MARKDOWN) {
    const body = BUNDLED_BODIES[id];
    if (typeof body !== 'string' || body.trim().length === 0) {
      throw new Error(
        `harness boot: ${file} missing or empty (Vite ?raw import failed or file unparseable)`
      );
    }
  }
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
  const fewShot = buildStaticFewShotXml();
  if (!fewShot.includes('<static_examples>') || fewShot.trim().length < 20) {
    throw new Error('harness boot: static few-shot slot missing or empty');
  }
}

/** System prompt for Agent V (single dynamic agent). */
export function buildOrchestratorSystemPrompt(): string {
  if (agentPromptCache !== null) return agentPromptCache;
  const bodies = sectionBodiesCache ?? BUNDLED_BODIES;
  const sections = AGENT_SECTIONS.map((s) => bodies[s.id]).join('\n\n---\n\n');
  const built = wrapXml(
    'system_instructions',
    `${sections}\n\n---\n\n${buildRuntimeLimitsBlock()}\n\n---\n\n${buildAgentToolCatalogue()}`
  );
  agentPromptCache = built;
  return built;
}

export function __resetOrchestratorPromptCacheForTests(): void {
  invalidateHarnessPromptCache();
}

/** Load user overrides into memory. Call at app boot and after harness edits. */
export async function warmHarnessOverrides(): Promise<void> {
  sectionBodiesCache = null;
  agentPromptCache = null;
  await loadSectionBodies();
}

/** Cache-layer slot `[1]` — static few-shot patterns (not in harness system prefix). */
export function buildStaticFewShotXml(): string {
  const bodies = sectionBodiesCache ?? BUNDLED_BODIES;
  return wrapXml('static_examples', bodies['static-examples'].trim());
}
