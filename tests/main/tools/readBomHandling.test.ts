/**
 * Pure-helper tests for the BOM-detect + BOM-decode surface
 * exposed through `__testing` on `src/main/tools/read.tool.ts`.
 *
 * Real `read` tool tests cover the FS pipeline end-to-end (they
 * write a temp file with each BOM and assert the returned `content`
 * is clean). These tests pin the lower layer so a future
 * contributor can't quietly regress the byte-order detection
 * order (UTF-32 LE BOM `FF FE 00 00` must win against UTF-16 LE
 * `FF FE` — the dominant historical regression).
 */

import { describe, expect, it } from 'vitest';
import { __testing } from '@main/tools/read.tool';

const { detectBomEncoding, bomDecode, detectUtf16NoBom, decodeUtf16NoBom, detectGarbledText } =
  __testing;

describe('detectBomEncoding', () => {
  it('detects the UTF-8 BOM (EF BB BF)', () => {
    const buf = Buffer.from([0xef, 0xbb, 0xbf, 0x41]);
    expect(detectBomEncoding(buf)).toBe('utf-8');
  });

  it('detects the UTF-16 LE BOM (FF FE) when no UTF-32 BOM matches', () => {
    const buf = Buffer.from([0xff, 0xfe, 0x41, 0x00]);
    expect(detectBomEncoding(buf)).toBe('utf-16le');
  });

  it('detects the UTF-16 BE BOM (FE FF)', () => {
    const buf = Buffer.from([0xfe, 0xff, 0x00, 0x41]);
    expect(detectBomEncoding(buf)).toBe('utf-16be');
  });

  it('detects the UTF-32 LE BOM (FF FE 00 00) BEFORE falling through to UTF-16 LE', () => {
    // Regression guard: the UTF-32 LE BOM shares its first two
    // bytes with the UTF-16 LE BOM. Detection MUST check the
    // 4-byte form first.
    const buf = Buffer.from([0xff, 0xfe, 0x00, 0x00, 0x41]);
    expect(detectBomEncoding(buf)).toBe('utf-32le');
  });

  it('detects the UTF-32 BE BOM (00 00 FE FF)', () => {
    const buf = Buffer.from([0x00, 0x00, 0xfe, 0xff, 0x00, 0x00, 0x00, 0x41]);
    expect(detectBomEncoding(buf)).toBe('utf-32be');
  });

  it('returns null when no BOM is present', () => {
    const buf = Buffer.from('plain ascii');
    expect(detectBomEncoding(buf)).toBeNull();
  });

  it('returns null for buffers too short to contain a BOM', () => {
    expect(detectBomEncoding(Buffer.from([0xef, 0xbb]))).toBeNull();
    expect(detectBomEncoding(Buffer.from([0xff]))).toBeNull();
    expect(detectBomEncoding(Buffer.from([]))).toBeNull();
  });
});

describe('bomDecode', () => {
  it('strips the UTF-8 BOM and decodes the body', () => {
    const buf = Buffer.concat([
      Buffer.from([0xef, 0xbb, 0xbf]),
      Buffer.from('hello', 'utf8')
    ]);
    expect(bomDecode(buf, 'utf-8')).toBe('hello');
  });

  it('decodes UTF-16 LE bodies and drops the BOM', () => {
    const buf = Buffer.concat([
      Buffer.from([0xff, 0xfe]),
      Buffer.from('hi', 'utf16le')
    ]);
    expect(bomDecode(buf, 'utf-16le')).toBe('hi');
  });

  it('decodes UTF-16 BE by byte-swapping and reusing the LE decoder', () => {
    // Encode 'hi' big-endian: 0x00 'h' 0x00 'i'.
    const buf = Buffer.from([0xfe, 0xff, 0x00, 0x68, 0x00, 0x69]);
    expect(bomDecode(buf, 'utf-16be')).toBe('hi');
  });

  it('decodes UTF-32 LE via code-point reconstruction', () => {
    // BOM + code points for 'A' (0x41), 'B' (0x42), 'C' (0x43) in LE.
    const buf = Buffer.from([
      0xff, 0xfe, 0x00, 0x00,
      0x41, 0x00, 0x00, 0x00,
      0x42, 0x00, 0x00, 0x00,
      0x43, 0x00, 0x00, 0x00
    ]);
    expect(bomDecode(buf, 'utf-32le')).toBe('ABC');
  });

  it('decodes UTF-32 BE via code-point reconstruction', () => {
    const buf = Buffer.from([
      0x00, 0x00, 0xfe, 0xff,
      0x00, 0x00, 0x00, 0x41,
      0x00, 0x00, 0x00, 0x42,
      0x00, 0x00, 0x00, 0x43
    ]);
    expect(bomDecode(buf, 'utf-32be')).toBe('ABC');
  });
});

describe('detectUtf16NoBom', () => {
  it('detects UTF-16 LE from alternating NUL pattern (no BOM)', () => {
    const buf = Buffer.from('hi', 'utf16le');
    expect(detectUtf16NoBom(buf)).toBe('utf-16le');
  });

  it('detects UTF-16 BE from alternating NUL pattern (no BOM)', () => {
    const buf = Buffer.from([0x00, 0x68, 0x00, 0x69]); // BE "hi"
    expect(detectUtf16NoBom(buf)).toBe('utf-16be');
  });

  it('returns null for plain UTF-8 ASCII', () => {
    expect(detectUtf16NoBom(Buffer.from('hello world'))).toBeNull();
  });
});

describe('decodeUtf16NoBom', () => {
  it('decodes UTF-16 LE bodies', () => {
    expect(decodeUtf16NoBom(Buffer.from('ab', 'utf16le'), 'utf-16le')).toBe('ab');
  });

  it('decodes UTF-16 BE bodies via byte swap', () => {
    const buf = Buffer.from([0x00, 0x41, 0x00, 0x42]);
    expect(decodeUtf16NoBom(buf, 'utf-16be')).toBe('AB');
  });
});

describe('detectGarbledText', () => {
  it('flags high replacement / question-mark ratio', () => {
    expect(detectGarbledText('????????normal')).toBe(true);
  });

  it('passes clean ASCII text', () => {
    expect(detectGarbledText('export const x = 1;\n')).toBe(false);
  });
});
