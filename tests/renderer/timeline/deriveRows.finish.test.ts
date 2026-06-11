import { describe, expect, it } from 'vitest';
import type { TimelineEvent } from '@shared/types/chat';
import { deriveRows } from '@renderer/components/timeline/reducer/deriveRows';

describe('deriveRows — finish', () => {
  it('does not fold finish tool-call / tool-result into a tool-group row', () => {
    const events: TimelineEvent[] = [
      {
        kind: 'user-prompt',
        id: 'p1',
        ts: 1,
        content: 'Document the harness'
      },
      {
        kind: 'agent-text-delta',
        id: 'a1',
        ts: 2,
        delta: 'I have completed the documentation.'
      },
      {
        kind: 'agent-text-end',
        id: 'a1',
        ts: 3
      },
      {
        kind: 'tool-call',
        id: 'tc-ev',
        ts: 4,
        call: {
          id: 'tc-finish',
          name: 'finish',
          args: { summary: 'I have completed the documentation.' }
        }
      },
      {
        kind: 'tool-result',
        id: 'tr-ev',
        ts: 5,
        result: {
          id: 'tc-finish',
          name: 'finish',
          ok: true,
          output: 'I have completed the documentation.',
          durationMs: 0
        }
      }
    ];

    const rows = deriveRows(events);
    expect(rows.some((r) => r.kind === 'tool-group' && r.toolName === 'finish')).toBe(false);
    expect(rows.some((r) => r.kind === 'assistant-text')).toBe(true);
  });

  it('does not synthesize partial finish rows from streaming args', () => {
    const events: TimelineEvent[] = [
      {
        kind: 'user-prompt',
        id: 'p1',
        ts: 1,
        content: 'Go'
      }
    ];
    const rows = deriveRows(events, {
      partialToolCallArgs: {
        'tc-partial': {
          callId: 'tc-partial',
          index: 0,
          ts: 2,
          name: 'finish',
          parsed: { summary: 'Still streaming…' }
        }
      },
      runActive: true
    });
    expect(rows.some((r) => r.kind === 'tool-group' && r.toolName === 'finish')).toBe(false);
  });
});
