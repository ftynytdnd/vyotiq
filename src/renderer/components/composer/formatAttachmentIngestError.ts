/**
 * User-facing message for attachment ingest IPC failures.
 */

const SIZE_LIMIT_RE = /exceeds \d+(\.\d+)? MB limit/i;

function unwrapIpcError(raw: string): string {
  if (!/Error invoking remote method/i.test(raw)) return raw;
  const inner = raw.match(/Error: (.+)$/)?.[1];
  return inner ?? raw;
}

export function formatAttachmentIngestError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const message = unwrapIpcError(raw);
  if (/ENOENT|no such file/i.test(message)) {
    return 'Could not find that file to attach. Try capturing or attaching again.';
  }
  if (SIZE_LIMIT_RE.test(message)) {
    return message;
  }
  if (/Error invoking remote method/i.test(raw)) {
    return 'Could not attach file. Try again or use the attach button.';
  }
  return message || 'Could not attach file.';
}
