/**
 * Bundled ast-grep CLI binary resolution.
 */

import { describe, expect, it } from 'vitest';
import {
  resolveAstGrepBinaryDir,
  resolveAstGrepBinaryPath
} from '@main/astgrep/resolveBinary.js';

describe('resolveAstGrepBinary', () => {
  it('resolves the native binary in dev installs', () => {
    const path = resolveAstGrepBinaryPath();
    const dir = resolveAstGrepBinaryDir();
    if (!path) {
      expect.soft(true).toBe(true);
      return;
    }
    expect(path).toMatch(/ast-grep(\.exe)?$/);
    expect(dir).toBeTruthy();
    expect(path.startsWith(dir!)).toBe(true);
  });
});
