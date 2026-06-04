/**
 * `handleAssistantTurn` — streaming assistant turn without mid-stream XML
 * delegate parsing (delegation is tool-only via `delegate` in `runLoop`).
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { ChatStreamDelta } from '@main/providers/chatClient';
import type { TimelineEvent } from '@shared/types/chat';

vi.mock('@main/providers/chatClient', () => ({
  streamChat: vi.fn()
}));

import { streamChat } from '@main/providers/chatClient';
import { handleAssistantTurn } from '@main/orchestrator/loop/handleAssistantTurn';

async function* asyncGen(
  deltas: ChatStreamDelta[]
): AsyncGenerator<ChatStreamDelta> {
  for (const d of deltas) yield d;
}

beforeEach(() => {
  vi.mocked(streamChat).mockReset();
});

describe('handleAssistantTurn', () => {
  it('streams text deltas for inline XML-like tags in prose', async () => {
    vi.mocked(streamChat).mockReturnValue(
      asyncGen([
        { contentDelta: 'Plan: I will spawn a sub-agent.\n\n' },
        { contentDelta: '<delegate id="A1" task="Read foo.ts" files="foo.ts" />' },
        { contentDelta: '\n\nDone.' },
        { finishReason: 'stop' }
      ])
    );
    const events: TimelineEvent[] = [];
    const out = await handleAssistantTurn(
      { providerId: 'p', model: 'm', messages: [], signal: new AbortController().signal },
      (e) => events.push(e)
    );

    expect(events.filter((e) => e.kind === 'subagent-pending')).toHaveLength(0);
    expect(events.filter((e) => e.kind === 'agent-text-delta').length).toBeGreaterThan(0);
    expect(out.assistantText).toContain('<delegate id="A1"');
    expect(out.error).toBeUndefined();
  });

  it('preserves prose-only streams without subagent-pending events', async () => {
    const proseChunks = [
      'Reasoning step one.\n',
      'Reasoning step two.\n',
      'Final answer.\n'
    ];
    vi.mocked(streamChat).mockReturnValue(
      asyncGen([...proseChunks.map((c) => ({ contentDelta: c })), { finishReason: 'stop' }])
    );
    const events: TimelineEvent[] = [];
    const out = await handleAssistantTurn(
      { providerId: 'p', model: 'm', messages: [], signal: new AbortController().signal },
      (e) => events.push(e)
    );
    expect(events.filter((e) => e.kind === 'subagent-pending')).toHaveLength(0);
    expect(out.assistantText).toBe(proseChunks.join(''));
  });
});
