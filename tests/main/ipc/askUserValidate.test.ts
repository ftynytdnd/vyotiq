/**
 * Runtime shape gate for `chat:submitAskUser` payloads.
 */

import { describe, expect, it } from 'vitest';
import { assertAskUserSubmitInput } from '@main/ipc/askUserValidate';

const BASE = {
  runId: 'run-1',
  conversationId: 'conv-1',
  promptEventId: 'evt-1',
  toolCallId: 'tool-1',
  payload: { questions: [] },
  answers: []
};

describe('assertAskUserSubmitInput', () => {
  it('accepts optional attachmentMeta', () => {
    expect(() =>
      assertAskUserSubmitInput({
        ...BASE,
        attachmentMeta: [
          { id: 'a1', name: 'readme.md', workspacePath: 'docs/readme.md' }
        ]
      })
    ).not.toThrow();
  });

  it('rejects malformed attachmentMeta', () => {
    expect(() =>
      assertAskUserSubmitInput({
        ...BASE,
        attachmentMeta: [{ id: 'a1', name: 'x.txt' }]
      })
    ).toThrow(/must include workspacePath or storedPath/);
  });
});
