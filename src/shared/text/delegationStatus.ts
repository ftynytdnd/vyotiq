/**
 * Shared copy for delegation round status labels (main run-status + renderer).
 */

export function formatDelegateSpawnStatusLabel(
  totalWorkers: number,
  inFlightMax?: number
): string {
  const total = Math.max(0, Math.floor(totalWorkers));
  const inFlight =
    typeof inFlightMax === 'number' && Number.isFinite(inFlightMax)
      ? Math.max(0, Math.floor(inFlightMax))
      : undefined;

  if (total <= 0) return 'Spawning workers…';
  if (total === 1) return 'Spawning 1 worker…';
  if (inFlight !== undefined && inFlight > 0 && inFlight < total) {
    return `Spawning ${total} workers (${inFlight} in flight)…`;
  }
  return `Spawning ${total} workers…`;
}
