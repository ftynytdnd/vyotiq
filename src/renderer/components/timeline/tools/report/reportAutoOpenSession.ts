/**
 * Prevents re-opening the same report when timeline rows remount
 * (conversation switch, virtualization) after a live auto-open.
 */

const consumed = new Set<string>();

export function consumeLiveReportAutoOpen(callId: string): boolean {
  if (consumed.has(callId)) return false;
  consumed.add(callId);
  return true;
}

/** Test-only: reset between cases. */
export function __test_resetReportAutoOpenSession(): void {
  consumed.clear();
}
