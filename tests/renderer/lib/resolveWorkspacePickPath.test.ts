import { describe, expect, it } from 'vitest';
import {
  resolveWorkspacePickPath,
  toAttachmentIngestPath
} from '@renderer/lib/resolveWorkspacePickPath.js';

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

describe('toAttachmentIngestPath', () => {
  const root = 'C:\\Users\\admin\\Documents\\agent';

  it('keeps workspace-relative paths relative', () => {
    expect(toAttachmentIngestPath('src/app.ts', root)).toBe('src/app.ts');
  });

  it('strips the workspace root from absolute in-workspace paths', () => {
    expect(toAttachmentIngestPath(`${root}\\captures\\screen.png`, root)).toBe(
      'captures/screen.png'
    );
  });

  it('decodes file URIs inside the workspace to relative paths', () => {
    const uri = 'file:///C:/Users/admin/Documents/agent/foo/bar.png';
    expect(toAttachmentIngestPath(uri, root)).toBe('foo/bar.png');
  });

  it('preserves external absolute paths', () => {
    expect(toAttachmentIngestPath('C:\\Other\\file.ts', root)).toBe('C:\\Other\\file.ts');
  });
});
