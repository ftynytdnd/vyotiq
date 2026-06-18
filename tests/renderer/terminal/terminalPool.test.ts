import { describe, expect, it } from 'vitest';
import { clampTerminalDimensions } from '@renderer/components/terminal/terminalPool';

describe('clampTerminalDimensions', () => {
  it('returns null for zero or negative dimensions', () => {
    expect(clampTerminalDimensions(0, 24)).toBeNull();
    expect(clampTerminalDimensions(80, 0)).toBeNull();
  });

  it('clamps cols to at least 20 and rows to at least 4', () => {
    expect(clampTerminalDimensions(8, 2)).toEqual({ cols: 20, rows: 4 });
    expect(clampTerminalDimensions(120, 40)).toEqual({ cols: 120, rows: 40 });
  });
});
