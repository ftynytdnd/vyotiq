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
  MAX_BACKOFF_MS,
  MAX_SELF_CORRECTION_ATTEMPTS,
  MAX_TOOL_OUTPUT_CHARS,
  MAX_TOTAL_ITERATIONS,
  STREAM_INACTIVITY_TIMEOUT_MS
} from '@shared/constants.js';

import orchestratorCore from './00-orchestrator-core.md?raw';
import contextLearning from './01-context-learning.md?raw';
import deliverables from './02-deliverables.md?raw';

const AGENT_SECTIONS: ReadonlyArray<{ title: string; body: string }> = [
  { title: 'Agent Core', body: orchestratorCore },
  { title: 'Context, Memory & Continuous Learning', body: contextLearning },
  { title: 'Deliverables — Markdown vs HTML Reports', body: deliverables }
];

const BOOTSTRAP_HARNESS_MARKDOWN: ReadonlyArray<{ file: string; body: string }> = [
  { file: '00-orchestrator-core.md', body: orchestratorCore },
  { file: '01-context-learning.md', body: contextLearning },
  { file: '02-deliverables.md', body: deliverables }
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

function buildRuntimeLimitsBlock(): string {
  return wrapXml(
    'runtime_limits',
    [
      `MAX_TOTAL_ITERATIONS=${MAX_TOTAL_ITERATIONS}`,
      `MAX_SELF_CORRECTION_ATTEMPTS=${MAX_SELF_CORRECTION_ATTEMPTS}`,
      `BASE_BACKOFF_MS=${BASE_BACKOFF_MS}`,
      `MAX_BACKOFF_MS=${MAX_BACKOFF_MS}`,
      `STREAM_INACTIVITY_TIMEOUT_MS=${STREAM_INACTIVITY_TIMEOUT_MS}`,
      `MAX_TOOL_OUTPUT_CHARS=${MAX_TOOL_OUTPUT_CHARS}`
    ].join('\n')
  );
}

function buildAgentToolCatalogue(): string {
  const directNames = new Set<string>(AGENT_TOOLS);
  const tools = listTools().filter((t) => directNames.has(t.name));
  const briefs = tools.map((t) => t.briefMarkdown).join('\n\n');
  return (
    `# Your Tools (callable via \`tool_calls\`)\n\n` +
    `Use tools when the task needs action. You may answer in plain prose when that fully satisfies the user.\n\n` +
    `- \`finish\` and \`ask_user\` are explicit ways to end a run. \`finish\` delivers your final answer; \`ask_user\` pauses for clarification.\n` +
    `- Substantive prose without tools also ends the run when it fully answers the user.\n\n` +
    briefs
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
}

/** System prompt for Agent V (single dynamic agent). */
export function buildOrchestratorSystemPrompt(): string {
  if (agentPromptCache !== null) return agentPromptCache;
  const sections = AGENT_SECTIONS.map((s) => s.body).join('\n\n---\n\n');
  const built = wrapXml(
    'system_instructions',
    `${sections}\n\n---\n\n${buildRuntimeLimitsBlock()}\n\n---\n\n${buildAgentToolCatalogue()}`
  );
  agentPromptCache = built;
  return built;
}

export function __resetOrchestratorPromptCacheForTests(): void {
  agentPromptCache = null;
}
