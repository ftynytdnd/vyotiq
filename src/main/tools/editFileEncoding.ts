/**
 * UTF-8 BOM + CRLF preservation for the `edit` tool.
 * Shared primitives live in `@shared/text/fileTextEncoding`.
 */

export {
  type DecodedFileText,
  type FileTextEncoding,
  composeOnDiskText,
  decodeUtf8FileForEdit as decodeFileForEdit,
  encodeUtf8FileForWrite as encodeFileForWrite
} from '@shared/text/fileTextEncoding.js';
