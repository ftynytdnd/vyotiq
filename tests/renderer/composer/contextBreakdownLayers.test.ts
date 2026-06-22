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

  it('layerWindowShare is relative to the model context window', () => {
    expect(layerWindowShare(9_700, 1_000_000)).toBe(1);
    expect(layerWindowShare(13_700, 1_000_000)).toBe(1);
    expect(layerWindowShare(50_000, 1_000_000)).toBe(5);
  });

  it('layerCompositionShare is relative to current prompt usage', () => {
    expect(layerCompositionShare(9_700, 13_700)).toBe(71);
    expect(layerCompositionShare(2_300, 13_700)).toBe(17);
  });

  it('activeBreakdownLayers sorts by token count descending', () => {
    const breakdown = {
      system: 10_000,
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
      'workspace'
    ]);
  });

  it('formatLayerWindowPct shows <1% for sub-half-percent layers', () => {
    expect(formatLayerWindowPct(468, 1_000_000)).toBe('<1%');
    expect(formatLayerWindowPct(5_000, 1_000_000)).toBe('1%');
    expect(formatLayerWindowPct(0, 1_000_000)).toBe('0%');
  });

  it('layerCompositionBarWidth uses fractional share without a display floor', () => {
    expect(layerCompositionBarWidth(13, 13_100)).toBeCloseTo(0.099, 2);
    expect(layerCompositionBarWidth(9_800, 13_100)).toBeCloseTo(74.81, 1);
  });

  it('formatOmittedLayerNote clarifies static prefix when history is empty', () => {
    const breakdown = {
      system: 10_000,
      workspace: 0,
      history: 0,
      runtime: 500,
      turn: 0,
      tools: 2_000
    };
    expect(formatOmittedLayerNote(['History'], breakdown)).toMatch(/harness, tools/);
    expect(formatOmittedLayerNote(['Workspace', 'History'], breakdown)).toBe(
      'Workspace, History empty'
    );
  });
});
