/**
 * In-memory discovery poll failure tracking for Settings hints.
 */

const pollFailuresByProvider = new Map<string, number>();
const pollHintsByProvider = new Map<string, string>();

export function recordDiscoveryPollSuccess(providerId: string): void {
  pollFailuresByProvider.delete(providerId);
  pollHintsByProvider.delete(providerId);
}

export function recordDiscoveryPollFailure(providerId: string, message: string): number {
  const next = (pollFailuresByProvider.get(providerId) ?? 0) + 1;
  pollFailuresByProvider.set(providerId, next);
  if (next >= 3) {
    pollHintsByProvider.set(
      providerId,
      `Background model refresh failed ${next} times. ${message}`
    );
  }
  return next;
}

export function getDiscoveryPollHint(providerId: string): string | undefined {
  return pollHintsByProvider.get(providerId);
}

export function getAllDiscoveryPollHints(): Record<string, string> {
  return Object.fromEntries(pollHintsByProvider);
}

export function clearDiscoveryPollStatus(providerId: string): void {
  pollFailuresByProvider.delete(providerId);
  pollHintsByProvider.delete(providerId);
}

export function publishDiscoveryPollSuccess(providerId: string): void {
  recordDiscoveryPollSuccess(providerId);
}

export function publishDiscoveryPollFailure(providerId: string, message: string): number {
  return recordDiscoveryPollFailure(providerId, message);
}

/** Test-only reset. */
export function __test_resetDiscoveryPollStatus(): void {
  pollFailuresByProvider.clear();
  pollHintsByProvider.clear();
}
