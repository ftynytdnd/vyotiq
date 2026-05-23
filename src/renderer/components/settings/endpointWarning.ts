/**
 * Live validation helper for the Web Search endpoint setting. Pulled
 * out of `SettingsPanel.tsx` so it can be unit-tested without
 * mounting the modal. Returns a user-facing message string when the
 * persisted endpoint would be refused at runtime by `runWebSearch`,
 * or `null` when the configuration is fine.
 *
 * The rules MUST stay in sync with `src/main/tools/search.tool.ts`.
 * Any drift means the UI says "looks good" while the tool refuses at
 * runtime.
 */

export function describeEndpointWarning(
  webSearchReachable: boolean,
  persisted: string
): string | null {
  const trimmed = persisted.trim();
  if (webSearchReachable && !trimmed) {
    return 'Web search is reachable (Fully Auto Mode is on for this workspace, or the user can approve outbound queries) but no endpoint is configured. Calls to `search` (mode: web) will fail until you set one.';
  }
  if (!trimmed) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return `"${trimmed}" is not a valid URL. The tool will refuse to use it.`;
  }
  const isLocalhost =
    url.hostname === 'localhost' ||
    url.hostname === '127.0.0.1' ||
    url.hostname === '::1' ||
    url.hostname === '[::1]';
  if (url.protocol !== 'https:' && !isLocalhost) {
    return `Non-HTTPS endpoints are only allowed for localhost. The tool will refuse to send queries to ${url.protocol}//${url.host}.`;
  }
  return null;
}
