import { describe, expect, it } from 'vitest';
import {
  __test_buildWindowsAgentScript,
  __test_wrapAgentCommand
} from '@main/terminal/ptyManager.js';

describe('pty agent command wrap', () => {
  it('evaluates Windows agent scripts in the current shell', () => {
    if (process.platform !== 'win32') return;

    const wrapped = __test_wrapAgentCommand('echo hello');
    expect(wrapped).not.toContain('powershell -NoProfile -EncodedCommand');
    expect(wrapped).toContain('[ScriptBlock]::Create');
    expect(wrapped).toContain('FromBase64String');
  });

  it('does not exit the shared PowerShell PTY after agent commands', () => {
    if (process.platform !== 'win32') return;

    const script = __test_buildWindowsAgentScript('npm run build');
    expect(script).not.toMatch(/\bexit\s+\$vyotiqEc\b/);
    expect(script).toContain('__VYOTIQ_CMD_END__');
  });
});
