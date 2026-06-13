/**
 * On-disk encoding helpers for the `edit` tool and in-app editor.
 */

import {
  decodeDiskTextBuffer,
  encodeDiskTextBody,
  type DecodedDiskText
} from '../text/decodeDiskText.js';
import {
  composeOnDiskText,
  decodeUtf8FileForEdit,
  type DecodedFileText,
  type FileTextEncoding
} from '@shared/text/fileTextEncoding.js';

export type { DecodedFileText, FileTextEncoding };

export interface EditFilePayload {
  body: string;
  /** Original on-disk bytes (for checkpoint preContent). */
  rawOriginal: Buffer;
  disk: DecodedDiskText;
}

export function decodeFileBufferForEdit(buf: Buffer): EditFilePayload {
  const disk = decodeDiskTextBuffer(buf);
  return { body: disk.body, rawOriginal: buf, disk };
}

/** Legacy UTF-8 string path (create flows, tests). */
export function decodeFileForEdit(raw: string): DecodedFileText {
  return decodeUtf8FileForEdit(raw);
}

export function composeOnDiskTextFromEdit(body: string, disk: DecodedDiskText): Buffer {
  return encodeDiskTextBody(body, disk);
}

export { composeOnDiskText, encodeDiskTextBody };
