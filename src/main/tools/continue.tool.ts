/**
 * `continue` tool — agent self-prompts the next loop iteration without finishing.
 */

import { randomUUID } from 'node:crypto';
import type { Tool } from './types.js';
import type { ToolResult } from '@shared/types/tool.js';
import { enqueueFollowUp } from '../followUps/followUpQueueService.js';
import { getActiveRunSelectionForConversation } from '../orchestrator/AgentV.js';
import { DEFAULT_DYNAMIC_LOOP_CONTINUE_PROMPT } from '../orchestrator/loop/dynamicLoopAudit.js';

export const continueTool: Tool = {
  name: 'continue',
  briefMarkdown: `### Tool: \`continue\`

**WHAT it is.** Self-prompt the **same run** to continue async iteration — audit recent work and take the next step **without** calling \`finish\`.

**HOW to use it.**

\`\`\`json
{ "name": "continue", "arguments": {} }
{ "name": "continue", "arguments": { "prompt": "Run tests, fix failures, then continue." } }
\`\`\`

Optional \`prompt\` overrides the host default continue text.

**WHY it exists.** The dynamic agent loop is async: work → audit → continue again and again in one run. Use this when you need an explicit self-steer instead of waiting for the host audit nudge.

**WHEN to trigger it.**
- After meaningful edits/tests when more in-run work remains.
- To queue your own next step before the loop re-enters.
- **Not** instead of \`finish\` when the task is fully done — detach \`heartbeat\` and \`finish\` then.`,
  schema: {
    type: 'function',
    function: {
      name: 'continue',
      description:
        'Self-prompt the same run to continue async work (audit + next step) without finishing.',
      parameters: {
        type: 'object',
        properties: {
          prompt: {
            type: 'string',
            description: 'Optional custom continue prompt; host default when omitted.'
          }
        }
      }
    }
  },
  async run(args, ctx): Promise<ToolResult> {
    const id = randomUUID();
    const started = Date.now();

    const active = getActiveRunSelectionForConversation(ctx.conversationId);
    if (!active) {
      return {
        id,
        name: 'continue',
        ok: false,
        output: 'Cannot continue: no active run selection for this conversation.',
        error: 'no active run selection',
        durationMs: Date.now() - started
      };
    }

    const prompt =
      typeof args.prompt === 'string' && args.prompt.trim()
        ? args.prompt.trim()
        : DEFAULT_DYNAMIC_LOOP_CONTINUE_PROMPT;

    try {
      await enqueueFollowUp({
        conversationId: ctx.conversationId,
        kind: 'steering',
        prompt,
        selection: { providerId: active.providerId, modelId: active.modelId },
        source: 'continue'
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        id,
        name: 'continue',
        ok: false,
        output: `Failed to enqueue continue prompt: ${message}`,
        error: 'enqueue failed',
        durationMs: Date.now() - started
      };
    }

    return {
      id,
      name: 'continue',
      ok: true,
      output: 'Continue prompt enqueued — loop will re-enter after this tool round.',
      durationMs: Date.now() - started
    };
  }
};
