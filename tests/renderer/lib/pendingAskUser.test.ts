import { describe, expect, it } from 'vitest';
import type { TimelineEvent } from '@shared/types/chat';
import { findPendingAskUserEvent } from '@renderer/lib/pendingAskUser';

const submittedPrompt = {
  kind: 'ask-user-prompt',
  id: 'p1',
  ts: 1,
  displayText: 'Q1',
  toolCallId: 'tc-1',
  runId: 'run-1',
  payload: {
    questions: [{ id: 'q1', prompt: 'Q1', options: [{ id: 'a', label: 'A' }] }]
  },
  status: 'submitted' as const
} satisfies TimelineEvent;

const pendingPrompt = {
  ...submittedPrompt,
  id: 'p2',
  status: 'pending' as const
};

describe('findPendingAskUserEvent', () => {
  it('returns null when not awaiting user', () => {
    expect(findPendingAskUserEvent([pendingPrompt], false)).toBeNull();
  });

  it('returns the latest pending prompt', () => {
    expect(findPendingAskUserEvent([submittedPrompt, pendingPrompt], true)).toEqual(
      pendingPrompt
    );
  });

  it('returns null when the latest prompt is already submitted', () => {
    expect(findPendingAskUserEvent([pendingPrompt, submittedPrompt], true)).toBeNull();
  });

  it('does not hide a newer pending prompt after an older submit marker', () => {
    const events: TimelineEvent[] = [
      submittedPrompt,
      { kind: 'ask-user-submitted', id: 's1', ts: 2, promptEventId: 'p1', toolCallId: 'tc-1', runId: 'run-1' },
      pendingPrompt
    ];
    expect(findPendingAskUserEvent(events, true)).toEqual(pendingPrompt);
  });
});
