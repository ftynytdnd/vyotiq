/**
 * dropConversation clears checkpoint pending cache for the removed id.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { useCheckpointsStore } from '@renderer/store/useCheckpointsStore';

beforeEach(() => {
  useCheckpointsStore.setState({
    pendingByConversation: {},
    summaryByWorkspace: {},
    summaryLoading: {},
    suppressNextTranscriptRewound: new Set<string>()
  });
});

describe('useCheckpointsStore.dropConversation', () => {
  it('removes cached pending rows for the conversation', () => {
    useCheckpointsStore.setState({
      pendingByConversation: {
        'conv-a': [{ entryId: 'e1' } as never],
        'conv-b': [{ entryId: 'e2' } as never]
      }
    });
    useCheckpointsStore.getState().dropConversation('conv-a');
    const pending = useCheckpointsStore.getState().pendingByConversation;
    expect(pending['conv-a']).toBeUndefined();
    expect(pending['conv-b']).toHaveLength(1);
  });
});
