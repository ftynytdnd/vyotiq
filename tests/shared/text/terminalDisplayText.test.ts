import { describe, expect, it } from 'vitest';
import {
  formatTerminalDisplay,
  hasVisibleTerminalOutput,
  stripTerminalControlSequences
} from '@shared/text/terminalDisplayText';

describe('terminalDisplayText', () => {
  it('strips ANSI color sequences', () => {
    expect(stripTerminalControlSequences('\x1b[32mok\x1b[0m')).toBe('ok');
  });

  it('collapses carriage-return overwrites', () => {
    expect(formatTerminalDisplay('line\rprogress')).toBe('progress');
  });

  it('treats control-only output as not visible', () => {
    expect(hasVisibleTerminalOutput('\x1b[?25l\x1b[2J')).toBe(false);
    expect(hasVisibleTerminalOutput('\r\r')).toBe(false);
  });

  it('keeps real command output visible', () => {
    expect(hasVisibleTerminalOutput('pytest failed\n')).toBe(true);
    expect(formatTerminalDisplay('pytest failed\n')).toBe('pytest failed\n');
  });
});
