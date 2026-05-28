/**
 * Checkpoint blob hash IPC validation — rejects traversal and non-hex.
 */

import { describe, expect, it } from 'vitest';
import { assertBlobHash } from '@main/ipc/validate.js';

describe('assertBlobHash', () => {
  const valid = 'a'.repeat(64);

  it('accepts 64 lowercase hex characters', () => {
    expect(() => assertBlobHash('test', 'hash', valid)).not.toThrow();
  });

  it('rejects path traversal segments', () => {
    expect(() =>
      assertBlobHash('test', 'hash', '../' + 'a'.repeat(61))
    ).toThrow(/64-character lowercase hex/);
  });

  it('rejects uppercase hex', () => {
    expect(() => assertBlobHash('test', 'hash', 'A'.repeat(64))).toThrow(
      /64-character lowercase hex/
    );
  });

  it('rejects slashes in the hash field', () => {
    const withSlash = 'ab/' + 'c'.repeat(61);
    expect(withSlash.length).toBe(64);
    expect(() => assertBlobHash('test', 'hash', withSlash)).toThrow(
      /64-character lowercase hex/
    );
  });

  it('rejects wrong length', () => {
    expect(() => assertBlobHash('test', 'hash', 'abc')).toThrow(
      /64-character lowercase hex/
    );
  });
});
