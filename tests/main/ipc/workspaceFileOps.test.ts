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

  it('allows workspace root reveal', () => {
    expect(() =>
      assertSafeRelativePath('workspace:reveal-path', 'path', '.', { allowDotRoot: true })
    ).not.toThrow();
  });

  it('allows read-only reveal under .vyotiq', () => {
    expect(() =>
      assertSafeRelativePath('workspace:reveal-path', 'path', '.vyotiq/generated/run-1.png', {
        allowDotVyotiq: true
      })
    ).not.toThrow();
  });

  it('still rejects dot root for mutating ops', () => {
    expect(() => assertSafeRelativePath('workspace:mkdir', 'path', '.')).toThrow(/invalid path/);
  });
});
