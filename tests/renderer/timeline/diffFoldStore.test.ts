import { describe, expect, it, beforeEach } from 'vitest';
import { useTimelineUiStore } from '@renderer/store/useTimelineUiStore';

describe('useTimelineUiStore diff fold expansion', () => {
  beforeEach(() => {
    useTimelineUiStore.setState({ diffFoldExpandedByScope: {} });
  });

  it('toggles fold ids within a scope key', () => {
    const scope = 'diff:1:hunk:0';
    useTimelineUiStore.getState().toggleDiffFold(scope, 'fold-a');
    expect(useTimelineUiStore.getState().diffFoldExpandedByScope[scope]?.has('fold-a')).toBe(true);
    useTimelineUiStore.getState().toggleDiffFold(scope, 'fold-a');
    expect(useTimelineUiStore.getState().diffFoldExpandedByScope[scope]?.has('fold-a')).toBe(false);
  });
});
