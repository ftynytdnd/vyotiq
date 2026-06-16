/**
 * @vitest-environment happy-dom
 */

import { describe, expect, it, beforeEach } from 'vitest';
import { buildXtermTheme, applyXtermTheme } from '../../../src/shared/terminal/xtermTheme.js';
import { Terminal } from '@xterm/xterm';

describe('buildXtermTheme', () => {
  beforeEach(() => {
    document.documentElement.style.setProperty('--color-surface-base', '#2a2b30');
    document.documentElement.style.setProperty('--color-text-primary', '#f0f0f0');
    document.documentElement.style.setProperty('--color-accent', '#b8a0ff');
  });

  it('uses an opaque surface-base background (not transparent black)', () => {
    const theme = buildXtermTheme();
    expect(theme.background).toBeTruthy();
    expect(theme.background).not.toBe('rgba(0, 0, 0, 0)');
    expect(theme.background).not.toMatch(/^rgba?\(0,\s*0,\s*0(?:,\s*0)?\)$/);
  });

  it('includes scrollbar slider tokens', () => {
    const theme = buildXtermTheme();
    expect(theme.scrollbarSliderBackground).toBeTruthy();
    expect(theme.scrollbarSliderHoverBackground).toBeTruthy();
    expect(theme.scrollbarSliderActiveBackground).toBeTruthy();
  });

  it('includes ANSI palette keys', () => {
    const theme = buildXtermTheme();
    expect(theme.red).toBeTruthy();
    expect(theme.green).toBeTruthy();
    expect(theme.blue).toBeTruthy();
    expect(theme.brightWhite).toBeTruthy();
  });
});

describe('applyXtermTheme', () => {
  it('assigns a fresh theme object reference to the terminal', () => {
    const term = new Terminal();
    const before = term.options.theme;
    applyXtermTheme(term);
    expect(term.options.theme).not.toBe(before);
    expect(term.options.theme?.background).toBeTruthy();
    term.dispose();
  });
});
