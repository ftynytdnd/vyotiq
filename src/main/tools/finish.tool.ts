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

**WHY it exists.** It makes "the task is complete" a deliberate, schema-enforced action with a clean final answer. A turn of substantive prose that fully answers the user also ends the run (implicit finish), but calling \`finish\` is the explicit, unambiguous signal — prefer it when the work involved tools or edits.

**WHEN to trigger it.** Once the work is verified done and you have a final answer for the user.

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
