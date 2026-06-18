/**
 * Runtime validation for follow-up rows loaded from disk.
 */

import { describe, expect, it } from 'vitest';
import { parseFollowUpMessage } from '@shared/followUps/parseFollowUpMessage.js';

describe('parseFollowUpMessage', () => {
  const valid = {
    id: 'fu-1',
    kind: 'queue',
    prompt: 'hello',
    selection: { providerId: 'p1', modelId: 'm1' },
    queuedAt: 1,
    source: 'composer'
  };

  it('accepts a valid row', () => {
    expect(parseFollowUpMessage(valid)).toEqual(valid);
  });

  it('rejects malformed rows', () => {
    expect(parseFollowUpMessage(null)).toBeNull();
    expect(parseFollowUpMessage({ ...valid, kind: 'bogus' })).toBeNull();
    expect(parseFollowUpMessage({ ...valid, selection: { providerId: 'p1' } })).toBeNull();
    expect(parseFollowUpMessage({ ...valid, queuedAt: 'nope' })).toBeNull();
  });

  it('defaults missing source to composer', () => {
    const { source: _source, ...withoutSource } = valid;
    expect(parseFollowUpMessage(withoutSource)?.source).toBe('composer');
  });
});
