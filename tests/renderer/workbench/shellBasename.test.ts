import { describe, expect, it } from 'vitest';
import { shellBasename } from '../../../src/renderer/components/workbench/workbenchShared.js';

describe('shellBasename', () => {
  it('strips directory and .exe suffix on Windows paths', () => {
    expect(shellBasename('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe')).toBe(
      'powershell'
    );
  });

  it('handles posix paths', () => {
    expect(shellBasename('/usr/bin/bash')).toBe('bash');
  });
});
