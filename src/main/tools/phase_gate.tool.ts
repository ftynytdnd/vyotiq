/**
 * `phase_gate` tool — submits structured phase artifacts for host validation.
 */

import type { Tool } from './types.js';
import { makeInterceptOnlyTool } from './interceptOnlyTool.js';

export const phaseGateTool: Tool = makeInterceptOnlyTool(
  'phase_gate',
  `### Tool: \`phase_gate\`

**WHAT it is.** Submits the current phased-execution artifact and requests advancement past the phase exit gate.

**HOW to use it.** Pass \`subtaskId\`, \`phase\` (must match the active phase), and a discriminated \`artifact\` object for that phase.

\`\`\`json
{
  "name": "phase_gate",
  "arguments": {
    "subtaskId": "<active-subtask-id>",
    "phase": "intake",
    "artifact": {
      "phase": "intake",
      "goalRestatement": "…",
      "doneCriteria": [{ "id": "c1", "description": "…" }],
      "acceptanceCommands": ["npm test"]
    }
  }
}
\`\`\`

**WHY it exists.** The host enforces phased execution: tool allowlists, checkpoint markers, and acceptance-test exit codes. This tool carries semantic artifacts; the host validates structure and deterministic gates.

**WHEN to trigger it.** Only when the current phase work is complete and the artifact satisfies the phase contract in \`05-phased-execution.md\`.`,
  {
    type: 'function',
    function: {
      name: 'phase_gate',
      description:
        'Submit phased-execution artifact and request gate advancement. Phase must match active phase; host validates schema and deterministic gates.',
      parameters: {
        type: 'object',
        properties: {
          subtaskId: { type: 'string', description: 'Active subtask id from <phase_state>.' },
          phase: {
            type: 'string',
            enum: [
              'intake',
              'understand',
              'think_frame',
              'plan',
              'rethink',
              'checkpoint',
              'execute',
              'verify',
              'diagnose',
              'reflect'
            ]
          },
          artifact: {
            type: 'object',
            description: 'Phase-specific artifact; must include matching `phase` field.'
          }
        },
        required: ['subtaskId', 'phase', 'artifact']
      }
    }
  }
);
