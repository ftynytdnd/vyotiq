import { describe, expect, it } from 'vitest';
import {
  clampDockWidth,
  DOCK_WIDTH_DEFAULT,
  DOCK_WIDTH_MAX,
  DOCK_WIDTH_MIN,
  normalizeDockWidthInUi
} from '@shared/dock/dockWidth';

describe('dockWidth', () => {
  it('clamps legacy values below the minimum', () => {
    expect(clampDockWidth(200)).toBe(DOCK_WIDTH_MIN);
    expect(clampDockWidth(DOCK_WIDTH_DEFAULT)).toBe(DOCK_WIDTH_DEFAULT);
    expect(clampDockWidth(400)).toBe(DOCK_WIDTH_MAX);
  });

  it('normalizes ui.dockWidth in place', () => {
    const { ui, changed } = normalizeDockWidthInUi({ dockWidth: 200, theme: 'dark' });
    expect(changed).toBe(true);
    expect(ui.dockWidth).toBe(DOCK_WIDTH_MIN);
    expect(ui.theme).toBe('dark');
  });
});
