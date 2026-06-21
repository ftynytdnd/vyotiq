/**
 * `heartbeat` tool — attach/detach per-conversation wake polling for async loop work.
 */

import { randomUUID } from 'node:crypto';
import type { Tool, ToolContext } from './types.js';
import type { ToolResult } from '@shared/types/tool.js';
import {
  HEARTBEAT_MAX_INTERVAL_MINUTES,
  HEARTBEAT_MIN_INTERVAL_MINUTES
} from '@shared/constants.js';
import {
  attachConversationHeartbeat,
  detachConversationHeartbeat,
  getConversationHeartbeat
} from '../heartbeat/conversationHeartbeatStore.js';
import { getActiveRunSelectionForConversation } from '../orchestrator/AgentV.js';
import { getConversationMeta } from '../conversations/conversationStore.js';

export const heartbeatTool: Tool = {
  name: 'heartbeat',
  briefMarkdown: `### Tool: \`heartbeat\`

**WHAT it is.** A per-conversation poll (every 5–10 minutes) that injects a status wake prompt so the **same orchestrator loop** can continue async work (PR review cycles, CI waits) without the user retyping.

**HOW to use it.**

\`\`\`json
{ "name": "heartbeat", "arguments": { "action": "attach", "intervalMinutes": 7 } }
{ "name": "heartbeat", "arguments": { "action": "detach" } }
{ "name": "heartbeat", "arguments": { "action": "status" } }
\`\`\`

Optional \`wakePrompt\` overrides the host default wake text.

**WHY it exists.** Merges autonomous iteration into the existing loop — not a second agent or fixed reviewer pipeline. See harness **Dynamic Agent Loop**.

**WHEN to trigger it.**
- **attach** when a segment may idle (PR open, waiting on external events) but work should resume automatically.
- **detach** before a final \`finish\` when no further wake-ups are needed.
- **status** to read the current attachment.`,
  schema: {
    type: 'function',
    function: {
      name: 'heartbeat',
      description:
        'Attach, detach, or read a per-conversation heartbeat that periodically wakes this thread for status checks.',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['attach', 'detach', 'status'] },
          intervalMinutes: {
            type: 'number',
            description: `Poll interval (${HEARTBEAT_MIN_INTERVAL_MINUTES}–${HEARTBEAT_MAX_INTERVAL_MINUTES} minutes). Required for attach.`
          },
          wakePrompt: {
            type: 'string',
            description: 'Optional custom wake prompt; host default when omitted.'
          }
        },
        required: ['action']
      }
    }
  },
  async run(args, ctx): Promise<ToolResult> {
    const id = randomUUID();
    const started = Date.now();
    const action = args.action;
    if (action !== 'attach' && action !== 'detach' && action !== 'status') {
      return {
        id,
        name: 'heartbeat',
        ok: false,
        output: 'Invalid action. Use attach, detach, or status.',
        error: 'invalid action',
        durationMs: Date.now() - started
      };
    }

    if (action === 'status') {
      const row = await getConversationHeartbeat(ctx.conversationId);
      if (!row) {
        return {
          id,
          name: 'heartbeat',
          ok: true,
          output: 'No heartbeat attached to this conversation.',
          durationMs: Date.now() - started
        };
      }
      return {
        id,
        name: 'heartbeat',
        ok: true,
        output: [
          'Heartbeat attached.',
          `intervalMinutes=${row.intervalMinutes}`,
          `nextWakeAt=${row.nextWakeAt ?? 'pending'}`,
          `wakePromptChars=${row.wakePrompt.length}`
        ].join('\n'),
        durationMs: Date.now() - started
      };
    }

    if (action === 'detach') {
      const ok = await detachConversationHeartbeat(ctx.conversationId);
      return {
        id,
        name: 'heartbeat',
        ok: true,
        output: ok ? 'Heartbeat detached.' : 'No heartbeat was attached.',
        durationMs: Date.now() - started
      };
    }

    const intervalRaw = args.intervalMinutes;
    if (typeof intervalRaw !== 'number' || !Number.isFinite(intervalRaw)) {
      return {
        id,
        name: 'heartbeat',
        ok: false,
        output: `attach requires intervalMinutes (${HEARTBEAT_MIN_INTERVAL_MINUTES}–${HEARTBEAT_MAX_INTERVAL_MINUTES}).`,
        error: 'missing intervalMinutes',
        durationMs: Date.now() - started
      };
    }

    const active = getActiveRunSelectionForConversation(ctx.conversationId);
    let selection = active
      ? { providerId: active.providerId, modelId: active.modelId }
      : null;
    if (!selection) {
      const meta = await getConversationMeta(ctx.conversationId);
      if (meta?.lastProviderId && meta?.lastModelId) {
        selection = { providerId: meta.lastProviderId, modelId: meta.lastModelId };
      }
    }
    if (!selection) {
      return {
        id,
        name: 'heartbeat',
        ok: false,
        output: 'Cannot attach heartbeat: no active run selection for this conversation.',
        error: 'no active run selection',
        durationMs: Date.now() - started
      };
    }

    const wakePrompt = typeof args.wakePrompt === 'string' ? args.wakePrompt : undefined;
    const row = await attachConversationHeartbeat({
      conversationId: ctx.conversationId,
      workspaceId: ctx.workspaceId,
      intervalMinutes: intervalRaw,
      wakePrompt,
      selection
    });

    return {
      id,
      name: 'heartbeat',
      ok: true,
      output: `Heartbeat attached. intervalMinutes=${row.intervalMinutes}. Next wake scheduled.`,
      durationMs: Date.now() - started
    };
  }
};
