/**
 * `ask_user` tool — pauses the run to surface clarifying question(s).
 *
 * When Agent V is genuinely blocked on a decision only the user can
 * make, it calls `ask_user`. The run ends cleanly (no error) after the
 * question is shown; the user's next reply resumes work with full
 * conversation history rebuilt from the store.
 *
 * NOTE: `ask_user` is dispatched specially by the run loop. The registry
 * `run` handler is a stub only.
 */

import type { Tool } from './types.js';
import { makeInterceptOnlyTool } from './interceptOnlyTool.js';

export const askUserTool: Tool = makeInterceptOnlyTool(
  'ask_user',
  `### Tool: \`ask_user\`

**WHAT it is.** A pause tool. Surfaces clarifying question(s) to the user and ends the current run; the user's reply resumes the work.

**HOW to use it.** Prefer structured \`questions\` (Cursor-like multi-choice). Legacy single \`question\` string is still accepted.

\`\`\`json
{
  "name": "ask_user",
  "arguments": {
    "title": "Migration scope",
    "questions": [
      {
        "id": "drop_column",
        "prompt": "Should the migration drop the legacy column?",
        "options": [
          { "id": "drop_now", "label": "Drop now" },
          { "id": "keep_one_release", "label": "Keep for one release" }
        ]
      }
    ]
  }
}
\`\`\`

**WHY it exists.** Some decisions only the user can make. Asking is a deliberate, schema-enforced pause — not a silent stall.

**WHEN to trigger it.** Only when you are genuinely blocked on a choice you cannot reasonably make yourself. Prefer making a sensible default decision and noting it over interrupting the user. Use when verification of prior tool results leaves you blocked — read the full transcript, then ask with enough context in each \`prompt\`.

**Notes.** Write prompts in English. This ends the run cleanly. The next user message rebuilds full history and continues the task. When the user replies to structured questions, they may answer in prose (e.g. \`drop_column: keep_one_release\`).`,
  {
    type: 'function',
    function: {
      name: 'ask_user',
      description:
        'Pause tool: surface clarifying question(s) to the user and end the current run. Prefer `title` + `questions[]` with options; legacy `question` string still accepted. Use only when genuinely blocked.',
      parameters: {
        type: 'object',
        properties: {
          title: {
            type: 'string',
            description: 'Optional heading shown above the question list.'
          },
          questions: {
            type: 'array',
            description:
              'Structured questions. Each needs `id`, `prompt`, and `options` (`id` + `label`). Set `allow_multiple: true` for multi-select.',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string', description: 'Stable id for this question.' },
                prompt: { type: 'string', description: 'Question text (English).' },
                options: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      id: { type: 'string' },
                      label: { type: 'string' }
                    },
                    required: ['id', 'label']
                  }
                },
                allow_multiple: {
                  type: 'boolean',
                  description: 'When true, the user may select more than one option.'
                }
              },
              required: ['id', 'prompt', 'options']
            }
          },
          question: {
            type: 'string',
            description:
              'Legacy: single clarifying question string. Prefer `questions[]` for multi-choice.'
          }
        }
      }
    }
  }
);
