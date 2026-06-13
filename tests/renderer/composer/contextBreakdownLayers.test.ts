import { describe, expect, it } from 'vitest';
import {
  activeBreakdownLayers,
  emptyBreakdownLabels,
  formatLayerWindowPct,
  formatOmittedLayerNote,
  layerCompositionBarWidth,
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

  it('formatLayerWindowPct shows <1% for sub-half-percent layers', () => {
    expect(formatLayerWindowPct(468, 200_000)).toBe('<1%');
    expect(formatLayerWindowPct(1_000, 200_000)).toBe('1%');
    expect(formatLayerWindowPct(0, 200_000)).toBe('0%');
  });

  it('layerCompositionBarWidth uses fractional share without a display floor', () => {
    expect(layerCompositionBarWidth(13, 13_100)).toBeCloseTo(0.099, 2);
    expect(layerCompositionBarWidth(9_800, 13_100)).toBeCloseTo(74.81, 1);
  });

  it('formatOmittedLayerNote clarifies static prefix when history is empty', () => {
    const breakdown = {
      system: 10_000,
      fewShot: 0,
      workspace: 0,
      history: 0,
      runtime: 500,
      turn: 0,
      tools: 2_000
    };
    expect(formatOmittedLayerNote(['History'], breakdown)).toMatch(/harness, tools/);
    expect(formatOmittedLayerNote(['Few-shot', 'History'], breakdown)).toBe(
      'Few-shot, History empty'
    );
  });
});
