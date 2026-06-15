import { describe, expect, it } from 'vitest';
import { assertSafeRelativePath } from '../../../src/main/workspace/workspacePathGuards.js';

describe('workspace path guards', () => {
  it('rejects .vyotiq paths', () => {
    expect(() => assertSafeRelativePath('workspace:mkdir', 'path', '.vyotiq/cache')).toThrow(
      /cannot modify/
    );
  });

  it('rejects parent traversal', () => {
    expect(() => assertSafeRelativePath('workspace:delete-path', 'path', '../outside')).toThrow(
      /stay inside/
    );
  });

  it('allows normal relative paths', () => {
    expect(() => assertSafeRelativePath('workspace:mkdir', 'path', 'src/components')).not.toThrow();
  });
});
