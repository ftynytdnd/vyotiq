import { describe, expect, it } from 'vitest';
import { resolveWorkspacePickPath } from '@renderer/lib/resolveWorkspacePickPath.js';

describe('resolveWorkspacePickPath', () => {
  it('joins relative paths to the workspace root', () => {
    expect(resolveWorkspacePickPath('src\\app.ts', 'C:\\Projects\\vyotiq')).toBe(
      'C:\\Projects\\vyotiq\\src\\app.ts'
    );
  });

  it('leaves absolute paths unchanged', () => {
    expect(resolveWorkspacePickPath('C:\\Other\\file.ts', 'C:\\Projects\\vyotiq')).toBe(
      'C:\\Other\\file.ts'
    );
    expect(resolveWorkspacePickPath('/tmp/file.ts', '/home/user/ws')).toBe('/tmp/file.ts');
  });

  it('returns the original path when no workspace root is available', () => {
    expect(resolveWorkspacePickPath('src/app.ts', null)).toBe('src/app.ts');
  });
});
