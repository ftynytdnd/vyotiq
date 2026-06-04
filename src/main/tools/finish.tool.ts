/**
 * `finish` tool — the terminal action that ends the orchestrator run.
 *
 * Calling `finish` is how Agent V declares the task complete. Its
 * `summary` becomes the final user-facing assistant answer.
 *
 * NOTE: `finish` is dispatched specially by the run loop. The registry
 * `run` handler is a stub only.
 */

import type { Tool } from './types.js';
import { makeInterceptOnlyTool } from './interceptOnlyTool.js';

export const finishTool: Tool = makeInterceptOnlyTool(
  'finish',
  `### Tool: \`finish\`

**WHAT it is.** The terminal tool. Calling it ends the run and delivers your final answer to the user.

**HOW to use it.** Pass the complete, user-facing answer as \`summary\`.

\`\`\`json
{ "name": "finish", "arguments": { "summary": "Done. I refactored X and verified Y; here is what changed…" } }
\`\`\`

**WHY it exists.** A run only stops when you explicitly finish. This makes "the task is complete" a deliberate, schema-enforced action instead of a guess based on whether you stopped emitting tool calls.

**WHEN to trigger it.** Once the work is verified done and you have a final answer for the user. Do NOT finish while delegated work is still needed.

**Notes.** \`summary\` is the literal text the user reads — write it for them, not as an internal note.`,
  {
    type: 'function',
    function: {
      name: 'finish',
      description:
        'Terminal tool that ends the run. The `summary` is delivered to the user as the final answer. Call this only when the task is complete and verified.',
      parameters: {
        type: 'object',
        properties: {
          summary: {
            type: 'string',
            description: 'The final, complete, user-facing answer for this task.'
          }
        },
        required: ['summary']
      }
    }
  }
);
