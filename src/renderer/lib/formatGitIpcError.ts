/**
 * User-facing message for workspace git IPC failures.
 */

import { unwrapIpcInvokeError } from '@shared/ipc/unwrapIpcInvokeError.js';

export function formatGitIpcError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const unwrapped = unwrapIpcInvokeError(raw);
  return unwrapped.trim() || 'Git operation failed.';
}
