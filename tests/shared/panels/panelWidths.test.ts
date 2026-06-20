import { describe, expect, it } from 'vitest';
import {
  clampPanelWidth,
  normalizePanelWidthsInUi,
  PANEL_WIDTH_DEFAULT,
  PANEL_WIDTH_MAX,
  PANEL_WIDTH_MIN
} from '@shared/panels/panelWidths.js';

describe('panelWidths', () => {
  it('clamps to 320–720', () => {
    expect(clampPanelWidth(200)).toBe(PANEL_WIDTH_MIN);
    expect(clampPanelWidth(800)).toBe(PANEL_WIDTH_MAX);
    expect(clampPanelWidth(640.4)).toBe(640);
  });

  it('defaults constant is within bounds', () => {
    expect(PANEL_WIDTH_DEFAULT).toBeGreaterThanOrEqual(PANEL_WIDTH_MIN);
    expect(PANEL_WIDTH_DEFAULT).toBeLessThanOrEqual(PANEL_WIDTH_MAX);
  });

  it('normalizePanelWidthsInUi clamps out-of-range entries', () => {
    const { ui, changed } = normalizePanelWidthsInUi({
      panelWidths: { 'model-picker': 200, 'mention-picker': 500 }
    });
    expect(changed).toBe(true);
    expect(ui.panelWidths).toEqual({
      'model-picker': PANEL_WIDTH_MIN,
      'mention-picker': 500
    });
  });
});
