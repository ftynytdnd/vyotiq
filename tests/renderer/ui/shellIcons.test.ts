import { describe, expect, it } from 'vitest';
import {
  SHELL_ACTION_ICON_STROKE,
  SHELL_CHROME_ICON_CLASS,
  SHELL_CHROME_ICON_STROKE,
  SHELL_MICRO_ICON_CLASS,
  SHELL_MICRO_ICON_STROKE,
  SHELL_ROW_ICON_CLASS,
  SHELL_ROW_ICON_STROKE,
  SHELL_TAB_ICON_CLASS,
  SHELL_TAB_ICON_STROKE,
  SHELL_WINDOW_ICON_STROKE
} from '../../../src/renderer/lib/shellIcons.js';

describe('shellIcons scale', () => {
  it('chrome icons use 16px box and 1.75 stroke', () => {
    expect(SHELL_CHROME_ICON_CLASS).toContain('h-4');
    expect(SHELL_CHROME_ICON_STROKE).toBe(1.75);
    expect(SHELL_TAB_ICON_STROKE).toBe(1.75);
    expect(SHELL_TAB_ICON_CLASS).toContain('h-4');
  });

  it('row/action icons use 14px box and 2.0 stroke', () => {
    expect(SHELL_ROW_ICON_CLASS).toContain('h-3.5');
    expect(SHELL_ROW_ICON_STROKE).toBe(2);
    expect(SHELL_ACTION_ICON_STROKE).toBe(2);
  });

  it('micro icons use 10px box and 2.0 stroke', () => {
    expect(SHELL_MICRO_ICON_CLASS).toContain('h-2.5');
    expect(SHELL_MICRO_ICON_STROKE).toBe(2);
  });

  it('window tray keeps heavier stroke', () => {
    expect(SHELL_WINDOW_ICON_STROKE).toBe(2.25);
  });
});
