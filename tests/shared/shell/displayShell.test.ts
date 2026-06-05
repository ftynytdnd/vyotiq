import { describe, expect, it } from 'vitest';
import { displayToolName, resolveShellToolTitle } from '@shared/shell/displayShell';

describe('displayShell', () => {
  it('maps win32 to powershell', () => {
    expect(resolveShellToolTitle('win32')).toBe('powershell');
    expect(displayToolName('bash', 'win32')).toBe('powershell');
  });

  it('maps unix platforms to bash', () => {
    expect(resolveShellToolTitle('linux')).toBe('bash');
    expect(resolveShellToolTitle('darwin')).toBe('bash');
    expect(displayToolName('bash', 'linux')).toBe('bash');
  });

  it('leaves non-bash tool names unchanged', () => {
    expect(displayToolName('read', 'win32')).toBe('read');
  });
});
