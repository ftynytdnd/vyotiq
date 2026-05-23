/**
 * Partial tool-call visibility gates for synthesized timeline rows.
 */

import { describe, expect, it } from 'vitest';
import {
  partialToolNameHint,
  shouldSynthesizePartialToolEntry
} from '@renderer/components/timeline/reducer/partialToolVisibility';

const KNOWN = ['read', 'edit', 'bash'] as const;

describe('partialToolVisibility', () => {
  it('returns false when no name or diff-stream tool hint exists', () => {
    expect(shouldSynthesizePartialToolEntry({}, KNOWN)).toBe(false);
    expect(partialToolNameHint({})).toBeUndefined();
  });

  it('returns true once a known tool name is present', () => {
    expect(shouldSynthesizePartialToolEntry({ name: 'read' }, KNOWN)).toBe(true);
  });

  it('accepts diff-stream tool hints before the name delta lands', () => {
    expect(
      shouldSynthesizePartialToolEntry(
        { diffStream: { tool: 'edit', hunks: [], settled: false } },
        KNOWN
      )
    ).toBe(true);
    expect(partialToolNameHint({ diffStream: { tool: 'edit' } })).toBe('edit');
  });
});
