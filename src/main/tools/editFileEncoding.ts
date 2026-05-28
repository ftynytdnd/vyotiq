/**
 * UTF-8 BOM + CRLF preservation for the `edit` tool.
 *
 * Reads strip an optional UTF-8 BOM for in-memory matching while
 * remembering whether to re-apply it on write. Line endings are
 * preserved: CRLF files stay CRLF; LF-only files stay LF.
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
export function decodeFileForEdit(raw: string): DecodedFileText {
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
export function encodeFileForWrite(body: string, encoding: FileTextEncoding): string {
  let out =
    encoding.eol === 'crlf'
      ? body.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n/g, '\r\n')
      : body.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  if (encoding.utf8Bom) out = '\uFEFF' + out;
  return out;
}

/** Compose on-disk text from edited body + remembered encoding. */
export function composeOnDiskText(editedBody: string, encoding: FileTextEncoding): string {
  return encodeFileForWrite(editedBody, encoding);
}
