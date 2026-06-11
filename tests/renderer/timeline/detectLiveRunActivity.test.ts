import { describe, expect, it } from 'vitest';
import { detectLiveRunActivity } from '@renderer/components/timeline/shared/detectLiveRunActivity';

describe('detectLiveRunActivity', () => {
  it('detects streaming assistant text', () => {
    const activity = detectLiveRunActivity({
      isProcessing: true,
      reasoningTexts: {},
      assistantTexts: {
        a1: { id: 'a1', text: 'Hello', done: false }
      },
      partialToolCallArgs: {},
      events: [],
      toolResultSettledIds: {}
    });
    expect(activity.streamingText).toBe(true);
  });

  it('detects streaming reasoning before text', () => {
    const activity = detectLiveRunActivity({
      isProcessing: true,
      reasoningTexts: {
        r1: { id: 'r1', text: 'hmm', done: false, startedAt: 1 }
      },
      assistantTexts: {
        a1: { id: 'a1', text: 'Hello', done: false }
      },
      partialToolCallArgs: {},
      events: [],
      toolResultSettledIds: {}
    });
    expect(activity.streamingReasoning).toBe(true);
  });

  it('detects an in-flight tool call', () => {
    const activity = detectLiveRunActivity({
      isProcessing: true,
      reasoningTexts: {},
      assistantTexts: {},
      partialToolCallArgs: {},
      events: [
        {
          kind: 'tool-call',
          id: 'e1',
          ts: 1,
          call: { id: 'c1', name: 'read', args: { path: 'foo.ts' } }
        }
      ],
      toolResultSettledIds: {}
    });
    expect(activity.activeToolName).toBe('read');
  });
});
