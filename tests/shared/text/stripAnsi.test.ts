import { describe, expect, it } from 'vitest';
import { sanitizeToolOutputForDisplay, stripAnsi } from '../../../src/shared/text/stripAnsi.js';

describe('stripAnsi', () => {
  it('removes CSI color codes', () => {
    expect(stripAnsi('\u001B[31merror\u001B[0m')).toBe('error');
  });

  it('removes cursor hide/show sequences', () => {
    expect(stripAnsi('\u001B[?25lhidden\u001B[?25h')).toBe('hidden');
  });

  it('sanitizes npm spinner noise', () => {
    const raw = '\r\n\u001B[?25l\u001B[1m\r\nUsing npm.\u001B[22m\r⠙\r⠹\u001B[K\rCreating project\r\n\u001B[?25h';
    const cleaned = sanitizeToolOutputForDisplay(raw);
    expect(cleaned).toContain('Using npm.');
    expect(cleaned).toContain('Creating project');
    expect(cleaned).not.toContain('[?25');
    expect(cleaned).not.toContain('⠙');
  });
});
