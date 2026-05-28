/**
 * Collapsed-rail workspace indicator truncation.
 */

import { describe, expect, it } from 'vitest';
import { dockWorkspaceIndicatorLabel } from '@renderer/components/dock/dockShared';

describe('dockWorkspaceIndicatorLabel', () => {
  it('returns em dash when label is missing', () => {
    expect(dockWorkspaceIndicatorLabel(null)).toBe('—');
    expect(dockWorkspaceIndicatorLabel('   ')).toBe('—');
  });

  it('keeps labels up to three characters', () => {
    expect(dockWorkspaceIndicatorLabel('Cod')).toBe('Cod');
    expect(dockWorkspaceIndicatorLabel('  ab ')).toBe('ab');
  });

  it('truncates longer labels to three characters', () => {
    expect(dockWorkspaceIndicatorLabel('Codex')).toBe('Cod');
    expect(dockWorkspaceIndicatorLabel('my-long-workspace')).toBe('my-');
  });
});
