/**
 * Sentinel error type for benign IPC outcomes that should propagate to
 * the renderer as a rejection but must NOT pollute the main-process
 * log with an `error`-level stack trace.
 *
 * Canonical example: the user dismisses the "choose workspace folder"
 * dialog. The dialog-promise resolves with `canceled: true`, the
 * handler throws `IpcCancelledError('workspace_add_cancelled')`, and
 * `wrapIpcHandler` (1) routes the throw to `log.info` instead of
 * `log.error`, (2) drops the stack from the log line, and (3) still
 * re-throws so the renderer's `invoke()` promise rejects exactly the
 * same way it did before. The renderer's `useWorkspaceStore.add()`
 * already catches this rejection and treats it as a no-op.
 *
 * Prefer a class over a sentinel-message-string match: future
 * cancellation paths can subclass without touching the wrapper, and
 * the type check is impossible to fool with an unrelated `Error`
 * whose message happens to collide.
 */

export class IpcCancelledError extends Error {
  readonly kind = 'cancelled' as const;
  constructor(message: string) {
    super(message);
    this.name = 'IpcCancelledError';
  }
}

export function isIpcCancelledError(err: unknown): err is IpcCancelledError {
  return err instanceof IpcCancelledError;
}
