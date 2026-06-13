/** In-flight discovery dedupe map — isolated to avoid store ↔ discovery cycles. */

const discoverInFlight = new Map<string, Promise<unknown>>();

export function getDiscoverInFlight<T>(providerId: string): Promise<T> | undefined {
  return discoverInFlight.get(providerId) as Promise<T> | undefined;
}

export function setDiscoverInFlight(providerId: string, flight: Promise<unknown>): void {
  discoverInFlight.set(providerId, flight);
}

export function evictDiscoverInFlight(providerId: string): void {
  discoverInFlight.delete(providerId);
}
