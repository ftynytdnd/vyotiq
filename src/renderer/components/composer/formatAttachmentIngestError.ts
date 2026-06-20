/**
 * User-facing message for attachment ingest IPC failures.
 */

import {
  formatAttachmentErrorReason,
  unwrapAttachmentIpcError
} from '@shared/attachments/formatAttachmentError.js';

export function formatAttachmentIngestError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const message = unwrapAttachmentIpcError(raw);
  const formatted = formatAttachmentErrorReason(message);
  if (formatted) return formatted;
  if (/Error invoking remote method/i.test(raw)) {
    return 'Could not attach file. Try again or use the attach button.';
  }
  return 'Could not attach file.';
}
