/**
 * `delegate` tool — spawns a real ephemeral sub-agent to carry out one
 * micro-task in its own blank context window.
 *
 * This is the orchestrator's primary actuator: instead of reading files
 * or running shell itself, Agent V emits `delegate` calls and fans them
 * out to a worker pool. Multiple `delegate` calls in a single assistant
 * turn run CONCURRENTLY — N parallel calls are the canonical way to
 * decompose an "analyze these files / do these N things" task.
 *
 * NOTE: `delegate` is dispatched specially by the run loop — the loop
 * intercepts it BY NAME, drains the turn's delegate calls into the
 * sub-agent pool (`handleDelegates`), and never routes them through the
 * generic tool executor. The registry `run` handler is a stub only.
 */

import type { Tool } from './types.js';
import { makeInterceptOnlyTool } from './interceptOnlyTool.js';

export const delegateTool: Tool = makeInterceptOnlyTool(
  'delegate',
  `### Tool: \`delegate\`

**WHAT it is.** Spawns a real, ephemeral sub-agent to perform exactly one micro-task in its own fresh context window. The sub-agent reports back; its internal turns stay isolated from your context.

**HOW to use it.** Emit one \`delegate\` call per micro-task, OR one call with a \`delegates\` array of specs (same turn). Both shapes fan out concurrently; omit \`concurrency\` unless you must limit in-flight sub-agents below the host default (all specs still spawn — extras queue).

\`\`\`json
{ "name": "delegate", "arguments": {
  "id": "w1",
  "task": "Summarize the public API surface of the orchestrator entry module",
  "files": ["src/main/orchestrator/AgentV.ts"],
  "tools": ["read", "search"]
}}
\`\`\`

**WHY it exists.** You are an orchestrator, not a sub-agent. Reading files or running shell directly into your own context defeats parallel decomposition. Delegation is how work actually happens.

**WHEN to trigger it.** Whenever a task needs file contents read, code edited, shell run, or any concrete work done. Decompose into the smallest independent units and fan them out.

**Per-turn budget (guidance).** Prefer 4–8 module-scoped delegates for analysis; ≤10 when planning; never exceed 12 delegate specs in one turn; ≤6 per turn for fix/edit after synthesis. Keep each \`task\` ≤3 sentences.

**Notes.** \`files\` and \`tools\` are optional; omit \`tools\` for the read-only default allowlist. Sub-agents cannot \`finish\`, \`ask_user\`, or \`delegate\` — those are orchestrator-only. Only you may call \`delegate\`.`,
  {
    type: 'function',
    function: {
      name: 'delegate',
      description:
        'Spawn a real ephemeral sub-agent to perform one micro-task in its own fresh context. Emit multiple delegate calls in a single turn to fan out concurrent parallel sub-agents (guidance: ≤12 per turn for analysis, ≤6 for fix/edit; prefer 4–8 module-scoped reads). Write task prose in English (≤3 sentences).',
      parameters: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: 'Short stable id for this sub-agent (e.g. "w1"). Used to correlate the result.'
          },
          task: {
            type: 'string',
            description:
              'Self-contained instruction in English for one deliverable. Good: "Read pkg/foo.ts and list exported functions." Bad: "Fix everything" or two unrelated outcomes in one string. For edits, name the target path and acceptance criteria; use a short structured brief or numbered sub-steps only when they serve a single deliverable. The host forwards this verbatim.'
          },
          files: {
            type: 'array',
            items: { type: 'string' },
            description:
              'Workspace-relative paths to preload. Required for edit delegations — list every path the sub-agent will touch (minimal set). A comma-separated string is also accepted.'
          },
          tools: {
            type: 'array',
            items: { type: 'string' },
            description:
              'Tool allowlist (e.g. ["read","edit","bash"]). Omit for read-only default. Add `edit` when modifying files; add `bash` for builds/tests.'
          },
          concurrency: {
            type: 'number',
            description:
              'Optional in-flight cap for this round when multiple delegates fire together. Omit to use the host default (all specs still spawn; extras queue). May be set on the batch root or each spec.'
          },
          delegates: {
            type: 'array',
            description:
              'Batch form: array of { id, task, files?, tools? } specs when emitting one tool call for many micro-tasks (common on hosts without parallel tool calls).'
          },
          depends_on: {
            type: 'array',
            items: { type: 'string' },
            description:
              'Optional tool_call_ids that must complete before this delegate runs (same assistant turn).'
          }
        },
        required: ['id', 'task']
      }
    }
  }
);
