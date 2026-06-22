/**
 * Resilience contract for the on-demand context-pack store.
 *
 * Covers:
 *   - `warmContextPacks` never rejects and leaves every body non-empty.
 *   - After `invalidateContextPacks` (cache null), `getContextPackBody`
 *     transparently falls back to the bundled bodies — never `undefined`.
 */

import { describe, expect, it } from 'vitest';
import {
  getContextPackBody,
  invalidateContextPacks,
  warmContextPacks
} from '@main/harness/contextPacks';
import { CONTEXT_PACK_IDS } from '@shared/types/harness';

describe('contextPacks resilience', () => {
  it('warmContextPacks resolves without throwing and bodies stay non-empty', async () => {
    await expect(warmContextPacks()).resolves.toBeUndefined();
    for (const id of CONTEXT_PACK_IDS) {
      expect(getContextPackBody(id).trim().length).toBeGreaterThan(20);
    }
  });

  it('falls back to bundled bodies when the cache is invalidated', () => {
    invalidateContextPacks();
    for (const id of CONTEXT_PACK_IDS) {
      const body = getContextPackBody(id);
      expect(typeof body).toBe('string');
      expect(body.trim().length).toBeGreaterThan(20);
    }
  });
});
