import { describe, expect, it } from 'vitest';
import { applyTimelineEvent } from '@renderer/components/timeline/reducer/applyTimelineEvent';
import { INITIAL_TIMELINE_STATE } from '@renderer/components/timeline/reducer/types';

describe('clearStreamingToolPreview on user-prompt', () => {
  it('clears partialToolCallArgs and liveDiffByCallId when a new prompt arrives', () => {
    let state = {
      ...INITIAL_TIMELINE_STATE,
      partialToolCallArgs: {
        call_1: {
          callId: 'call_1',
          index: 0,
          name: 'delete',
          parsed: { path: 'docs/architecture.md' }
        }
      },
      liveDiffByCallId: {
        call_1: {
          tool: 'delete',
          filePath: 'docs/architecture.md',
          hunks: [],
          additions: 0,
          deletions: 0,
          settled: false,
          ts: Date.now()
        }
      }
    };

    state = applyTimelineEvent(state, {
      kind: 'user-prompt',
      id: 'prompt-2',
      ts: Date.now(),
      content: 'hi'
    });

    expect(state.partialToolCallArgs).toEqual({});
    expect(state.liveDiffByCallId).toEqual({});
    expect(state.events).toHaveLength(1);
  });
});
