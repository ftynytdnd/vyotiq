import { describe, expect, it } from 'vitest';
import {
  activeBreakdownLayers,
  emptyBreakdownLabels,
  layerCompositionShare,
  layerShare,
  layerWindowShare
} from '@renderer/components/composer/contextBreakdownLayers';

describe('contextBreakdownLayers', () => {
  it('layerShare returns 0 for empty inputs', () => {
    expect(layerShare(0, 100)).toBe(0);
    expect(layerShare(10, 0)).toBe(0);
  });

  it('layerWindowShare is relative to the usable context window', () => {
    expect(layerWindowShare(9_700, 200_000)).toBe(5);
    expect(layerWindowShare(13_700, 200_000)).toBe(7);
  });

  it('layerCompositionShare is relative to current prompt usage', () => {
    expect(layerCompositionShare(9_700, 13_700)).toBe(71);
    expect(layerCompositionShare(2_300, 13_700)).toBe(17);
  });

  it('activeBreakdownLayers sorts by token count descending', () => {
    const breakdown = {
      system: 10_000,
      fewShot: 500,
      workspace: 100,
      history: 0,
      runtime: 1_200,
      turn: 0,
      tools: 2_000
    };
    const active = activeBreakdownLayers(breakdown);
    expect(active.map((l) => l.key)).toEqual([
      'system',
      'tools',
      'runtime',
      'fewShot',
      'workspace'
    ]);
  });

  it('emptyBreakdownLabels lists only zero layers', () => {
    const breakdown = {
      system: 1,
      fewShot: 0,
      workspace: 0,
      history: 0,
      runtime: 1,
      turn: 0,
      tools: 1
    };
    expect(emptyBreakdownLabels(breakdown)).toEqual(['Few-shot', 'Workspace', 'History', 'Turn']);
  });
});
