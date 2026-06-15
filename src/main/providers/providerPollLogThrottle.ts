/**
 * Rate-limit repeated provider poll warnings so offline sessions do not
 * flood vyotiq.log with identical lines every 5s.
 */

const entries = new Map<string, { message: string; count: number; lastLoggedAt: number }>();

/** Log on first failure, message change, every 20th repeat, or after 5 minutes. */
export function shouldLogRepeatedPollWarning(
  key: string,
  message: string,
  now = Date.now()
): boolean {
  const prev = entries.get(key);
  if (!prev) {
    entries.set(key, { message, count: 1, lastLoggedAt: now });
    return true;
  }
  const nextCount = prev.count + 1;
  const messageChanged = prev.message !== message;
  const intervalElapsed = now - prev.lastLoggedAt >= 5 * 60_000;
  const milestone = nextCount % 20 === 0;
  if (messageChanged || intervalElapsed || milestone) {
    entries.set(key, { message, count: nextCount, lastLoggedAt: now });
    return true;
  }
  entries.set(key, { message, count: nextCount, lastLoggedAt: prev.lastLoggedAt });
  return false;
}

export function recordPollSuccess(key: string): void {
  entries.delete(key);
}

/** Test-only reset. */
export function __test_resetProviderPollLogThrottle(): void {
  entries.clear();
}
