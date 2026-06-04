/**
 * Crash-time run abort hook. `AgentV` registers the real implementation
 * at module load so `logger` can drain active runs without importing
 * `AgentV` (which would create a logger ↔ orchestrator cycle).
 */

let drainRuns: ((message: string) => void) | null = null;

export function registerRunCrashDrain(handler: (message: string) => void): void {
  drainRuns = handler;
}

export function abortAllActiveRunsWithError(message: string): void {
  drainRuns?.(message);
}
