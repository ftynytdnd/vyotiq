/**
 * DisplayRow — alias of derived timeline rows for delegation rendering.
 */

import { describe, expect, it } from 'vitest';
import type { DisplayRow } from '@renderer/components/timeline/shared/displayRowTypes.js';
import type { Row } from '@renderer/components/timeline/reducer/deriveRows.js';

describe('DisplayRow', () => {
  it('accepts the same row shapes as Row', () => {
    const row: Row = {
      kind: 'user-prompt',
      key: 'u1',
      id: 'u1',
      content: 'hi'
    };
    const display: DisplayRow = row;
    expect(display.kind).toBe('user-prompt');
  });
});
