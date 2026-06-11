/**
 * Shared registry of renderer surfaces that request fast provider polling.
 * Account and discovery pollers read the same set for adaptive cadence.
 */

const activePollSources = new Set<string>();

export function setProviderPollSource(source: string, active: boolean): void {
  const trimmed = source.trim();
  if (!trimmed) return;
  if (active) activePollSources.add(trimmed);
  else activePollSources.delete(trimmed);
}

export function hasActivePollSources(): boolean {
  return activePollSources.size > 0;
}

export function getActivePollSources(): readonly string[] {
  return [...activePollSources];
}

export function clearProviderPollSources(): void {
  activePollSources.clear();
}

/** Test-only reset. */
export function __test_resetProviderPollSources(): void {
  activePollSources.clear();
}
