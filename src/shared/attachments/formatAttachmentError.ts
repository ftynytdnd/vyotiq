/**
 * User-facing attachment ingest error copy (shared by main + renderer).
 */

const SIZE_LIMIT_RE = /exceeds \d+(\.\d+)? MB limit/i;

export const ATTACHMENT_ERROR_NOT_FOUND =
  'Could not find that file to attach. Try capturing or attaching again.';

export const ATTACHMENT_ERROR_NOT_A_FILE =
  'That path is not a file. Choose a file or use Attach folder.';

export const ATTACHMENT_ERROR_PASTE_FAILED = 'Could not paste file from clipboard.';

/** Normalize a rejection reason or IPC error message for display. */
export function formatAttachmentErrorReason(reason: string): string {
  const trimmed = reason.trim();
  if (!trimmed) return ATTACHMENT_ERROR_PASTE_FAILED;
  if (/ENOENT|no such file/i.test(trimmed)) {
    return ATTACHMENT_ERROR_NOT_FOUND;
  }
  if (/^Not a file$/i.test(trimmed)) {
    return ATTACHMENT_ERROR_NOT_A_FILE;
  }
  if (SIZE_LIMIT_RE.test(trimmed)) {
    return trimmed;
  }
  return trimmed;
}

/** Unwrap Electron `Error invoking remote method` wrappers. */
export function unwrapAttachmentIpcError(raw: string): string {
  if (!/Error invoking remote method/i.test(raw)) return raw;
  const inner = raw.match(/Error: (.+)$/)?.[1];
  return inner ?? raw;
}
