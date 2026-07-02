import { describe, expect, it } from 'vitest';
import {
  authoringModelDiffersFrom,
  formatAuthoringModelHint
} from '../../../src/renderer/lib/authoringModelHint.js';

describe('authoringModelHint', () => {
  it('formats hint with model id', () => {
    expect(formatAuthoringModelHint({ providerId: 'p1', modelId: 'claude-opus' })).toContain(
      'claude-opus'
    );
  });

  it('detects when composer model differs from authoring model', () => {
    expect(
      authoringModelDiffersFrom(
        { providerId: 'p1', modelId: 'opus' },
        { providerId: 'p2', modelId: 'llama' }
      )
    ).toBe(true);
    expect(
      authoringModelDiffersFrom(
        { providerId: 'p1', modelId: 'opus' },
        { providerId: 'p1', modelId: 'opus' }
      )
    ).toBe(false);
    expect(authoringModelDiffersFrom(undefined, { providerId: 'p1', modelId: 'm' })).toBe(
      false
    );
  });
});
