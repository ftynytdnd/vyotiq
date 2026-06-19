/**
 * User-facing message for attachment ingest IPC failures.
 */

export function formatAttachmentIngestError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  if (/ENOENT|no such file/i.test(raw)) {
    return 'Could not find that file to attach. Try capturing or attaching again.';
  }
  if (/exceeds.*MB limit/i.test(raw)) {
    return raw;
  }
  if (/Error invoking remote method/i.test(raw)) {
    const inner = raw.match(/Error: (.+)$/)?.[1];
    if (inner && /ENOENT|no such file/i.test(inner)) {
      return 'Could not find that file to attach. Try capturing or attaching again.';
    }
    return 'Could not attach file. Try again or use the attach button.';
  }
  return raw || 'Could not attach file.';
}
