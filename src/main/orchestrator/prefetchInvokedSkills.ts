/**
 * Host prefetch — load slash-invoked skills before the first model iteration.
 *
 * Inserts synthetic assistant tool-call + tool-result pairs into the history
 * band and emits matching timeline events so ContextInvocation renders them.
 */

import { randomUUID } from 'node:crypto';
import { resolveSkillAlias } from '@shared/skills/skillAliases.js';
import type { ChatMessage, TimelineEvent } from '@shared/types/chat.js';
import { stableStringify } from '@shared/json/stableStringify.js';
import { truncateToolOutputForContext } from '@shared/text/truncateUtf8Safe.js';
import { contextTool, seedInvokedSkills } from '../tools/context.tool.js';
import type { ToolContext } from '../tools/types.js';
import { insertHistoryBeforeTail } from './context/buildContextLayers.js';

export interface PrefetchInvokedSkillsOpts {
  invokedSkills: readonly string[];
  workspacePath: string;
  workspaceId: string;
  runId: string;
  conversationId: string;
  signal: AbortSignal;
  messages: ChatMessage[];
  emit: (event: TimelineEvent) => void;
}

export async function prefetchInvokedSkills(opts: PrefetchInvokedSkillsOpts): Promise<void> {
  const names = [
    ...new Set(opts.invokedSkills.map((s) => resolveSkillAlias(s.trim())).filter(Boolean))
  ];
  if (names.length === 0) return;

  seedInvokedSkills(opts.signal, names);

  const ctx: ToolContext = {
    workspacePath: opts.workspacePath,
    workspaceId: opts.workspaceId,
    runId: opts.runId,
    conversationId: opts.conversationId,
    signal: opts.signal,
    emit: opts.emit
  };

  const assistantCalls: NonNullable<ChatMessage['tool_calls']> = [];
  const toolRows: ChatMessage[] = [];

  for (const skillName of names) {
    const result = await contextTool.run({ action: 'load', skill: skillName }, ctx);
    if (!result.ok) {
      opts.emit({
        kind: 'agent-thought',
        id: randomUUID(),
        ts: Date.now(),
        content: `Failed to prefetch skill /${skillName}: ${result.error ?? 'skill unavailable'}`,
        severity: 'warn'
      });
      continue;
    }
    if (
      result.data?.tool === 'context' &&
      result.data.action === 'load' &&
      result.data.alreadyLoaded
    ) {
      continue;
    }

    const callId = randomUUID();
    const args = { action: 'load', skill: skillName };
    assistantCalls.push({
      id: callId,
      type: 'function',
      function: { name: 'context', arguments: stableStringify(args) }
    });

    opts.emit({
      kind: 'tool-call',
      id: randomUUID(),
      ts: Date.now(),
      call: { id: callId, name: 'context', args }
    });

    opts.emit({
      kind: 'tool-result',
      id: randomUUID(),
      ts: Date.now(),
      result: {
        id: callId,
        name: 'context',
        ok: result.ok,
        output: result.output,
        ...(result.error ? { error: result.error } : {}),
        durationMs: result.durationMs,
        ...(result.data ? { data: result.data } : {})
      }
    });

    toolRows.push({
      role: 'tool',
      tool_call_id: callId,
      name: 'context',
      content: truncateToolOutputForContext(result.output)
    });
  }

  if (assistantCalls.length === 0) return;

  insertHistoryBeforeTail(
    opts.messages,
    {
      role: 'assistant',
      content: null,
      tool_calls: assistantCalls
    },
    ...toolRows
  );
}
