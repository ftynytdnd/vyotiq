/**
 * Regression tests for the IPC input-shape validators (audit fix
 * 2026-06-P2-1).
 *
 * The helpers in `src/main/ipc/validate.ts` are the runtime defense-
 * in-depth gate every non-chat IPC handler now sits behind. These
 * tests pin:
 *
 *   1. Type rejection — non-string for `assertString`, non-object for
 *      `assertObject`, etc. throws a structured `<channel>: <field>`
 *      error.
 *   2. Byte-cap rejection — a multi-byte unicode payload over the cap
 *      rejects on UTF-8 byte length, not char length.
 *   3. Enum rejection — values outside the allowed list throw with
 *      a preview of the bad value (capped at 40 chars).
 *   4. Optional-variant pass-through — `assertOptionalString` /
 *      `assertOptionalObject` accept `undefined` without throwing.
 *   5. Number validation — finite/integer/min/max gates fire on the
 *      right edge cases.
 */

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MAX_STRING_BYTES,
  assertString,
  assertOptionalString,
  assertObject,
  assertOptionalObject,
  assertBoolean,
  assertNumber,
  assertEnum,
  assertStringArray
} from '@main/ipc/validate';

describe('assertString', () => {
  it('accepts a normal string', () => {
    expect(() => assertString('chan', 'field', 'hello')).not.toThrow();
  });

  it('rejects non-string values with channel + field in the message', () => {
    expect(() => assertString('chan', 'field', 42)).toThrow(/chan: field must be a string/);
    expect(() => assertString('chan', 'field', null)).toThrow(/chan: field must be a string/);
    expect(() => assertString('chan', 'field', undefined)).toThrow(/chan: field must be a string/);
    expect(() => assertString('chan', 'field', {})).toThrow(/chan: field must be a string/);
  });

  it('rejects empty strings by default', () => {
    expect(() => assertString('chan', 'field', '')).toThrow(/non-empty/);
  });

  it('accepts empty strings when nonEmpty: false', () => {
    expect(() => assertString('chan', 'field', '', { nonEmpty: false })).not.toThrow();
  });

  it('rejects strings over the default byte cap', () => {
    const over = 'a'.repeat(DEFAULT_MAX_STRING_BYTES + 1);
    expect(() => assertString('chan', 'field', over)).toThrow(/exceeds the/);
  });

  it('measures byte length (UTF-8), not char length', () => {
    // A 3-byte emoji × N still fits under the cap when N × 4 < cap;
    // each emoji here serializes to 4 UTF-8 bytes via surrogate pair.
    const emojiBytes = Buffer.byteLength('🎉', 'utf8');
    expect(emojiBytes).toBe(4);
    const wellUnderCap = '🎉'.repeat(10);
    expect(() => assertString('chan', 'field', wellUnderCap, { maxBytes: 100 })).not.toThrow();
    // Push 30 emojis = 120 bytes → over the 100-byte cap, even though
    // the char length is only 30.
    const overCap = '🎉'.repeat(30);
    expect(() => assertString('chan', 'field', overCap, { maxBytes: 100 })).toThrow(/exceeds/);
  });

  it('honors a custom maxBytes override', () => {
    expect(() => assertString('chan', 'field', 'a'.repeat(50), { maxBytes: 10 })).toThrow(/10-byte cap/);
  });
});

describe('assertOptionalString', () => {
  it('passes for undefined', () => {
    expect(() => assertOptionalString('chan', 'field', undefined)).not.toThrow();
  });

  it('rejects non-string non-undefined values', () => {
    expect(() => assertOptionalString('chan', 'field', 42)).toThrow();
    expect(() => assertOptionalString('chan', 'field', null)).toThrow();
  });

  it('still rejects empty by default when present', () => {
    expect(() => assertOptionalString('chan', 'field', '')).toThrow(/non-empty/);
  });
});

describe('assertObject', () => {
  it('accepts a plain object', () => {
    expect(() => assertObject('chan', 'payload', { a: 1 })).not.toThrow();
  });

  it('rejects null / undefined / arrays / primitives', () => {
    expect(() => assertObject('chan', 'payload', null)).toThrow(/non-null object/);
    expect(() => assertObject('chan', 'payload', undefined)).toThrow(/non-null object/);
    expect(() => assertObject('chan', 'payload', [])).toThrow(/non-null object/);
    expect(() => assertObject('chan', 'payload', [1, 2, 3])).toThrow(/non-null object/);
    expect(() => assertObject('chan', 'payload', 'hello')).toThrow(/non-null object/);
    expect(() => assertObject('chan', 'payload', 42)).toThrow(/non-null object/);
  });
});

describe('assertOptionalObject', () => {
  it('passes for undefined', () => {
    expect(() => assertOptionalObject('chan', 'payload', undefined)).not.toThrow();
  });

  it('still rejects null + arrays', () => {
    expect(() => assertOptionalObject('chan', 'payload', null)).toThrow();
    expect(() => assertOptionalObject('chan', 'payload', [])).toThrow();
  });
});

describe('assertBoolean', () => {
  it('accepts true and false', () => {
    expect(() => assertBoolean('chan', 'flag', true)).not.toThrow();
    expect(() => assertBoolean('chan', 'flag', false)).not.toThrow();
  });

  it('rejects "true" / 1 / 0 / null', () => {
    expect(() => assertBoolean('chan', 'flag', 'true')).toThrow(/must be a boolean/);
    expect(() => assertBoolean('chan', 'flag', 1)).toThrow(/must be a boolean/);
    expect(() => assertBoolean('chan', 'flag', 0)).toThrow(/must be a boolean/);
    expect(() => assertBoolean('chan', 'flag', null)).toThrow(/must be a boolean/);
  });
});

describe('assertNumber', () => {
  it('accepts plain finite numbers', () => {
    expect(() => assertNumber('chan', 'n', 42)).not.toThrow();
    expect(() => assertNumber('chan', 'n', 0)).not.toThrow();
    expect(() => assertNumber('chan', 'n', -1.5)).not.toThrow();
  });

  it('rejects NaN / Infinity by default', () => {
    expect(() => assertNumber('chan', 'n', Number.NaN)).toThrow(/finite/);
    expect(() => assertNumber('chan', 'n', Number.POSITIVE_INFINITY)).toThrow(/finite/);
  });

  it('enforces integer when requested', () => {
    expect(() => assertNumber('chan', 'n', 1.5, { integer: true })).toThrow(/integer/);
    expect(() => assertNumber('chan', 'n', 1, { integer: true })).not.toThrow();
  });

  it('enforces min and max bounds', () => {
    expect(() => assertNumber('chan', 'n', 5, { min: 10 })).toThrow(/>= 10/);
    expect(() => assertNumber('chan', 'n', 15, { max: 10 })).toThrow(/<= 10/);
    expect(() => assertNumber('chan', 'n', 10, { min: 1, max: 10 })).not.toThrow();
    expect(() => assertNumber('chan', 'n', 1, { min: 1, max: 10 })).not.toThrow();
  });

  it('rejects non-number values', () => {
    expect(() => assertNumber('chan', 'n', '42' as unknown)).toThrow(/must be a number/);
    expect(() => assertNumber('chan', 'n', null)).toThrow(/must be a number/);
  });
});

describe('assertEnum', () => {
  const ALLOWED = ['global', 'workspace'] as const;

  it('accepts every allowed value', () => {
    expect(() => assertEnum('chan', 'scope', 'global', ALLOWED)).not.toThrow();
    expect(() => assertEnum('chan', 'scope', 'workspace', ALLOWED)).not.toThrow();
  });

  it('rejects values outside the allow-list with a preview', () => {
    expect(() => assertEnum('chan', 'scope', 'GLOBAL', ALLOWED)).toThrow(/one of: global, workspace/);
    // The preview is capped at 40 chars so a hostile multi-MB payload
    // can't bloat the error message.
    const big = 'x'.repeat(500);
    expect(() => assertEnum('chan', 'scope', big, ALLOWED)).toThrow(/received "x{40}"/);
  });

  it('rejects non-string values', () => {
    expect(() => assertEnum('chan', 'scope', 42, ALLOWED)).toThrow(/must be a string/);
    expect(() => assertEnum('chan', 'scope', null, ALLOWED)).toThrow(/must be a string/);
  });
});

describe('assertStringArray', () => {
  it('accepts string arrays and validates each slot', () => {
    expect(() => assertStringArray('chan', 'paths', ['a.ts', 'b.ts'])).not.toThrow();
  });

  it('rejects non-arrays and non-string elements', () => {
    expect(() => assertStringArray('chan', 'paths', 'a.ts')).toThrow(/must be an array/);
    expect(() => assertStringArray('chan', 'paths', [1])).toThrow(/paths\[0\] must be a string/);
  });
});
