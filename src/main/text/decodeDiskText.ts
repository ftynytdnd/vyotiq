/**
 * Decode on-disk text buffers for read/edit/editor — BOM-aware UTF-8/16/32.
 * Binary refusal heuristics match the `read` tool.
 */

import { Buffer } from 'node:buffer';

export type DiskTextEncoding =
  | 'utf-8'
  | 'utf-16le'
  | 'utf-16be'
  | 'utf-32le'
  | 'utf-32be';

export interface DecodedDiskText {
  body: string;
  /** Raw bytes to persist (includes BOM when present). */
  raw: Buffer;
  encoding: DiskTextEncoding;
  utf8Bom: boolean;
  eol: 'crlf' | 'lf';
}

export function detectBomEncoding(
  buf: Buffer
): DiskTextEncoding | null {
  if (buf.length >= 4) {
    if (buf[0] === 0xff && buf[1] === 0xfe && buf[2] === 0x00 && buf[3] === 0x00) return 'utf-32le';
    if (buf[0] === 0x00 && buf[1] === 0x00 && buf[2] === 0xfe && buf[3] === 0xff) return 'utf-32be';
  }
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return 'utf-8';
  if (buf.length >= 2) {
    if (buf[0] === 0xff && buf[1] === 0xfe) return 'utf-16le';
    if (buf[0] === 0xfe && buf[1] === 0xff) return 'utf-16be';
  }
  return null;
}

export function bomDecode(buf: Buffer, enc: DiskTextEncoding): string {
  if (enc === 'utf-8') {
    return buf.subarray(3).toString('utf8');
  }
  if (enc === 'utf-16le') {
    return buf.subarray(2).toString('utf16le');
  }
  if (enc === 'utf-16be') {
    const body = buf.subarray(2);
    const swapped = Buffer.alloc(body.length);
    for (let i = 0; i + 1 < body.length; i += 2) {
      swapped[i] = body[i + 1]!;
      swapped[i + 1] = body[i]!;
    }
    return swapped.toString('utf16le');
  }
  const body = buf.subarray(4);
  const out: string[] = [];
  for (let i = 0; i + 3 < body.length; i += 4) {
    const cp =
      enc === 'utf-32le'
        ? body[i]! | (body[i + 1]! << 8) | (body[i + 2]! << 16) | (body[i + 3]! << 24)
        : (body[i]! << 24) | (body[i + 1]! << 16) | (body[i + 2]! << 8) | body[i + 3]!;
    out.push(String.fromCodePoint(cp >>> 0));
  }
  return out.join('');
}

export function detectUtf16NoBom(buf: Buffer): 'utf-16le' | 'utf-16be' | null {
  const probeLen = Math.min(buf.length, 8192);
  if (probeLen < 4) return null;
  let oddNulls = 0;
  let evenNulls = 0;
  let oddPrintable = 0;
  let evenPrintable = 0;
  const pairs = Math.floor(probeLen / 2);
  for (let i = 0; i < probeLen; i++) {
    const b = buf[i]!;
    if (i % 2 === 0) {
      if (b === 0) evenNulls++;
      else if (b >= 32 && b < 127) evenPrintable++;
    } else {
      if (b === 0) oddNulls++;
      else if (b >= 32 && b < 127) oddPrintable++;
    }
  }
  if (pairs < 2) return null;
  if (oddNulls / pairs >= 0.35 && evenPrintable / pairs >= 0.25) return 'utf-16le';
  if (evenNulls / pairs >= 0.35 && oddPrintable / pairs >= 0.25) return 'utf-16be';
  return null;
}

export function decodeUtf16NoBom(buf: Buffer, enc: 'utf-16le' | 'utf-16be'): string {
  if (enc === 'utf-16le') return buf.toString('utf16le');
  const swapped = Buffer.alloc(buf.length);
  for (let i = 0; i + 1 < buf.length; i += 2) {
    swapped[i] = buf[i + 1]!;
    swapped[i + 1] = buf[i]!;
  }
  return swapped.toString('utf16le');
}

export type BinaryRefusalReason = { ok: false; detail: string } | { ok: true };

export function probeBinaryText(buf: Buffer): BinaryRefusalReason {
  const bomEnc = detectBomEncoding(buf);
  if (bomEnc !== null) {
    const text = bomDecode(buf, bomEnc);
    return probeDecodedText(text, `${bomEnc} BOM`);
  }
  const noBomEnc = detectUtf16NoBom(buf);
  if (noBomEnc !== null) {
    const text = decodeUtf16NoBom(buf, noBomEnc);
    return probeDecodedText(text, `${noBomEnc} (no BOM)`);
  }
  const probe = buf.subarray(0, Math.min(8192, buf.length));
  let nonText = 0;
  for (let i = 0; i < probe.length; i++) {
    const b = probe[i]!;
    if (b === 0) {
      return { ok: false, detail: `NUL at offset ${i}` };
    }
    if ((b < 9 || (b > 13 && b < 32)) && b < 128) nonText++;
  }
  if (probe.length > 0 && nonText > probe.length * 0.05) {
    return { ok: false, detail: `${nonText} control bytes in first ${probe.length}` };
  }
  return { ok: true };
}

function probeDecodedText(text: string, label: string): BinaryRefusalReason {
  const decodedProbe = text.slice(0, 8192);
  let decodedNonText = 0;
  for (let i = 0; i < decodedProbe.length; i++) {
    const code = decodedProbe.charCodeAt(i);
    if (code === 0) {
      return { ok: false, detail: `NUL after ${label} at char ${i}` };
    }
    if ((code < 9 || (code > 13 && code < 32)) && code < 128) decodedNonText++;
  }
  if (decodedProbe.length > 0 && decodedNonText > decodedProbe.length * 0.05) {
    return { ok: false, detail: `${label} but >5% control bytes` };
  }
  return { ok: true };
}

/** Decode a file buffer to a Unicode string + on-disk encoding metadata. */
export function decodeDiskTextBuffer(buf: Buffer): DecodedDiskText {
  const bomEnc = detectBomEncoding(buf);
  if (bomEnc !== null) {
    const body = bomDecode(buf, bomEnc);
    return {
      body,
      raw: buf,
      encoding: bomEnc,
      utf8Bom: bomEnc === 'utf-8',
      eol: body.includes('\r\n') ? 'crlf' : 'lf'
    };
  }
  const noBomEnc = detectUtf16NoBom(buf);
  if (noBomEnc !== null) {
    const body = decodeUtf16NoBom(buf, noBomEnc);
    return {
      body,
      raw: buf,
      encoding: noBomEnc,
      utf8Bom: false,
      eol: body.includes('\r\n') ? 'crlf' : 'lf'
    };
  }
  let body = buf.toString('utf8');
  let utf8Bom = false;
  if (body.length > 0 && body.charCodeAt(0) === 0xfeff) {
    utf8Bom = true;
    body = body.slice(1);
  }
  return {
    body,
    raw: buf,
    encoding: 'utf-8',
    utf8Bom,
    eol: body.includes('\r\n') ? 'crlf' : 'lf'
  };
}

/** Re-encode edited body to the original on-disk encoding. */
export function encodeDiskTextBody(body: string, meta: DecodedDiskText): Buffer {
  let normalized =
    meta.eol === 'crlf'
      ? body.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n/g, '\r\n')
      : body.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  switch (meta.encoding) {
    case 'utf-8': {
      if (meta.utf8Bom) normalized = '\uFEFF' + normalized;
      return Buffer.from(normalized, 'utf8');
    }
    case 'utf-16le': {
      const payload = Buffer.from(normalized, 'utf16le');
      return Buffer.concat([Buffer.from([0xff, 0xfe]), payload]);
    }
    case 'utf-16be': {
      const le = Buffer.from(normalized, 'utf16le');
      const be = Buffer.alloc(le.length);
      for (let i = 0; i + 1 < le.length; i += 2) {
        be[i] = le[i + 1]!;
        be[i + 1] = le[i]!;
      }
      return Buffer.concat([Buffer.from([0xfe, 0xff]), be]);
    }
    case 'utf-32le':
    case 'utf-32be': {
      const bom =
        meta.encoding === 'utf-32le'
          ? Buffer.from([0xff, 0xfe, 0x00, 0x00])
          : Buffer.from([0x00, 0x00, 0xfe, 0xff]);
      const chars = [...normalized];
      const out = Buffer.alloc(chars.length * 4);
      for (let i = 0; i < chars.length; i++) {
        const cp = chars[i]!.codePointAt(0) ?? 0;
        if (meta.encoding === 'utf-32le') {
          out[i * 4] = cp & 0xff;
          out[i * 4 + 1] = (cp >> 8) & 0xff;
          out[i * 4 + 2] = (cp >> 16) & 0xff;
          out[i * 4 + 3] = (cp >> 24) & 0xff;
        } else {
          out[i * 4] = (cp >> 24) & 0xff;
          out[i * 4 + 1] = (cp >> 16) & 0xff;
          out[i * 4 + 2] = (cp >> 8) & 0xff;
          out[i * 4 + 3] = cp & 0xff;
        }
      }
      return Buffer.concat([bom, out]);
    }
    default: {
      const _exhaustive: never = meta.encoding;
      return Buffer.from(String(_exhaustive), 'utf8');
    }
  }
}
