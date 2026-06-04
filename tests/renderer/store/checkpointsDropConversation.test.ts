/**
 * dropConversation clears rewind suppression state for the removed id.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { useCheckpointsStore } from '@renderer/store/useCheckpointsStore';

beforeEach(() => {
  useCheckpointsStore.setState({
    suppressNextTranscriptRewound: new Set<string>()
  });
});

describe('useCheckpointsStore.dropConversation', () => {
  it('removes suppressNextTranscriptRewound token for the conversation', () => {
    useCheckpointsStore.setState({
      suppressNextTranscriptRewound: new Set(['conv-a', 'conv-b'])
    });
    useCheckpointsStore.getState().dropConversation('conv-a');
    const suppress = useCheckpointsStore.getState().suppressNextTranscriptRewound;
    expect(suppress.has('conv-a')).toBe(false);
    expect(suppress.has('conv-b')).toBe(true);
  });
});
