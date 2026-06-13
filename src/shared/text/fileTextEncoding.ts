/**
 * Shared on-disk text encoding rules for read vs edit tools.
 *
 * | Concern              | `read`                         | `edit`                    |
 * |----------------------|--------------------------------|---------------------------|
 * | UTF-8 BOM            | Strip for display; detect wide | Strip for match; re-apply |
 * | UTF-16/32 BOM        | Decode to UTF-8 string         | Preserve via decodeDiskText |
 * | CRLF vs LF           | Normalized in returned slice   | Preserved on write        |
 * | Binary refusal       | NUL / control-byte heuristics  | N/A (text path only)      |
 */

export interface FileTextEncoding {
  /** True when the on-disk file opened with a UTF-8 BOM. */
  utf8Bom: boolean;
  eol: 'crlf' | 'lf';
}

export interface DecodedFileText {
  /** Text used for matching / splicing (BOM stripped). */
  body: string;
  encoding: FileTextEncoding;
}

/** Decode a UTF-8 file read for edit operations. */
export function decodeUtf8FileForEdit(raw: string): DecodedFileText {
  let body = raw;
  let utf8Bom = false;
  if (body.length > 0 && body.charCodeAt(0) === 0xfeff) {
    utf8Bom = true;
    body = body.slice(1);
  }
  const eol: 'crlf' | 'lf' = body.includes('\r\n') ? 'crlf' : 'lf';
  return { body, encoding: { utf8Bom, eol } };
}

/** Re-encode edited body for `fs.writeFile`. */
export function encodeUtf8FileForWrite(body: string, encoding: FileTextEncoding): string {
  let out =
    encoding.eol === 'crlf'
      ? body.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n/g, '\r\n')
      : body.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  if (encoding.utf8Bom) out = '\uFEFF' + out;
  return out;
}

/** Compose on-disk text from edited body + remembered encoding. */
export function composeOnDiskText(editedBody: string, encoding: FileTextEncoding): string {
  return encodeUtf8FileForWrite(editedBody, encoding);
}
