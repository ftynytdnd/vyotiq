/**
 * Sub-agent tool rounds must forward persistent timeline events that
 * `handleToolCalls` emits but the streaming hooks do not cover.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatStreamDelta } from '@main/providers/chatClient';
import type { TimelineEvent } from '@shared/types/chat';

vi.mock('@main/providers/chatClient', () => ({
  streamChat: vi.fn()
}));
vi.mock('@main/harness/harnessLoader', () => ({
  buildSubagentSystemPrompt: () => '<system_instructions>stub</system_instructions>'
}));
vi.mock('@main/orchestrator/contextManager', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@main/orchestrator/contextManager')>();
  return {
    ...actual,
    inlineFiles: vi.fn(async () => '')
  };
});
vi.mock('@main/orchestrator/retry', () => ({
  backoff: vi.fn(async () => undefined)
}));

const handleToolCalls = vi.fn<
  Parameters<typeof import('@main/orchestrator/loop/handleToolCalls').handleToolCalls>,
  ReturnType<typeof import('@main/orchestrator/loop/handleToolCalls').handleToolCalls>
>();

vi.mock('@main/orchestrator/loop/handleToolCalls', () => ({
  handleToolCalls: (...args: Parameters<typeof handleToolCalls>) => handleToolCalls(...args)
}));

import { streamChat } from '@main/providers/chatClient';
import { runSubAgent } from '@main/orchestrator/SubAgent';

async function* streamOf(deltas: ChatStreamDelta[]): AsyncGenerator<ChatStreamDelta> {
  for (const d of deltas) yield d;
}

const baseSpec = {
  id: 'A1',
  task: 'Edit the README.',
  files: [],
  tools: ['edit']
};

const baseDeps = {
  selection: { providerId: 'p', modelId: 'm' },
  workspacePath: 'C:/tmp/ws',
  workspaceId: 'ws-test',
  runId: 'run-test',
  conversationId: 'conv-test',
  strictApprovals: false,
  permissions: { allowAuto: false },
  signal: new AbortController().signal
};

beforeEach(() => {
  vi.mocked(streamChat).mockReset();
  handleToolCalls.mockReset();
});

describe('runSubAgent — persistent timeline passthrough', () => {
  it('forwards checkpoint-entry and phase events via onTimelineEvent', async () => {
    handleToolCalls.mockImplementationOnce(async (_calls, _msgs, emit) => {
      emit({
        kind: 'checkpoint-entry',
        id: 'entry-1',
        ts: 10,
        entryId: 'entry-1',
        runId: 'run-test',
        conversationId: 'conv-test',
        workspaceId: 'ws-test',
        filePath: 'README.md',
        changeKind: 'modify',
        additions: 1,
        deletions: 0,
        source: 'edit',
        subagentId: 'A1'
      } satisfies TimelineEvent);
      emit({
        kind: 'phase',
        id: 'phase-1',
        ts: 11,
        label: 'Sub-agent attempted re-delegation (refused — use <result>)'
      } satisfies TimelineEvent);
      return { attempted: 1, failed: 0, childRedelegations: 0 };
    });

    vi.mocked(streamChat)
      .mockImplementationOnce(() =>
        streamOf([
          {
            toolCallDelta: { index: 0, id: 'call-1', name: 'edit', argumentsDelta: '{}' }
          },
          { finishReason: 'tool_calls' }
        ])
      )
      .mockImplementationOnce(() =>
        streamOf([
          {
            contentDelta:
              '<result>\n<status>success</status>\n<summary>Done.</summary>\n</result>'
          },
          { finishReason: 'stop' }
        ])
      );

    const forwarded: TimelineEvent[] = [];
    await runSubAgent(baseSpec, {
      ...baseDeps,
      onTimelineEvent: (event) => {
        forwarded.push(event);
      }
    });

    expect(forwarded.map((e) => e.kind)).toEqual(['checkpoint-entry', 'phase']);
    expect(forwarded[0]).toMatchObject({ kind: 'checkpoint-entry', subagentId: 'A1' });
  });

  it('does not double-forward tool-call events handled by onToolCall', async () => {
    handleToolCalls.mockImplementationOnce(async (_calls, _msgs, emit) => {
      emit({
        kind: 'tool-call',
        id: 'tc-1',
        ts: 1,
        call: { id: 'call-1', name: 'edit', args: {} },
        subagentId: 'A1'
      } satisfies TimelineEvent);
      return { attempted: 1, failed: 0, childRedelegations: 0 };
    });

    vi.mocked(streamChat)
      .mockImplementationOnce(() =>
        streamOf([
          {
            toolCallDelta: { index: 0, id: 'call-1', name: 'edit', argumentsDelta: '{}' }
          },
          { finishReason: 'tool_calls' }
        ])
      )
      .mockImplementationOnce(() =>
        streamOf([
          {
            contentDelta:
              '<result>\n<status>success</status>\n<summary>Done.</summary>\n</result>'
          },
          { finishReason: 'stop' }
        ])
      );

    const toolCalls: string[] = [];
    const forwarded: TimelineEvent[] = [];
    await runSubAgent(baseSpec, {
      ...baseDeps,
      onToolCall: (call) => {
        toolCalls.push(call.id);
      },
      onTimelineEvent: (event) => {
        forwarded.push(event);
      }
    });

    expect(toolCalls).toEqual(['call-1']);
    expect(forwarded).toEqual([]);
  });
});
