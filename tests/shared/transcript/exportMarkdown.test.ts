import { describe, expect, it } from 'vitest';
import { renderTranscriptMarkdown } from '@shared/transcript/exportMarkdown.js';
import type { TimelineEvent } from '@shared/types/chat.js';

describe('renderTranscriptMarkdown', () => {
  it('renders user prompts and coalesced agent text', () => {
    const events: TimelineEvent[] = [
      { kind: 'user-prompt', id: 'u1', ts: 1_000, content: 'Hello', runId: 'r1' },
      { kind: 'agent-text-delta', id: 'a1', ts: 2_000, delta: 'Hi ' },
      { kind: 'agent-text-delta', id: 'a1', ts: 2_001, delta: 'there' },
      { kind: 'agent-text-end', id: 'a1', ts: 2_002 }
    ];
    const md = renderTranscriptMarkdown(events, 'Test chat');
    expect(md).toContain('# Test chat');
    expect(md).toContain('Hello');
    expect(md).toContain('Hi there');
  });
});
