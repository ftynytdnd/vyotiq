import { describe, expect, it } from 'vitest';
import { selectRunRecoveryState } from '@renderer/lib/runRecovery';
import type { TimelineEvent } from '@shared/types/chat';

const error: TimelineEvent = {
  kind: 'error',
  id: 'e1',
  ts: 1,
  message: 'Provider failed 3 times in a row: Ollama Cloud: Rate limit exceeded.'
};

describe('selectRunRecoveryState', () => {
  it('returns null while processing or without a prior prompt', () => {
    expect(selectRunRecoveryState([error], true, 'hi')).toBeNull();
    expect(selectRunRecoveryState([error], false, '')).toBeNull();
  });

  it('returns recovery when the last event is a terminal error', () => {
    const state = selectRunRecoveryState([error], false, 'hi');
    expect(state?.errorMessage).toContain('Rate limit');
    expect(state?.suggestProviders).toBe(true);
  });

  it('returns null when a later non-error event superseded the failure', () => {
    const thought: TimelineEvent = {
      kind: 'agent-thought',
      id: 't1',
      ts: 2,
      content: 'Recovered.'
    };
    expect(selectRunRecoveryState([error, thought], false, 'hi')).toBeNull();
  });
});
