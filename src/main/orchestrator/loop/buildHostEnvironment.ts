/**
 * Builds the `<host_environment>` envelope — a small, real-time snapshot
 * of date/time and host-system facts the orchestrator needs to give
 * correct time-relative answers and pick OS-appropriate tool
 * invocations without having to probe.
 *
 * Rebuilt fresh on every orchestrator iteration (NO caching) so the
 * timestamp the model sees is accurate to within the iteration round
 * trip. Cost is microsecond-cheap: one `Date` instantiation, a handful
 * of synchronous `os.*` / `process.*` reads, and a `wrapXml` call.
 *
 * The envelope is deliberately NOT folded into `ContextEnvelopes` /
 * `refreshEnvelopes`: that path has a 3-second TTL cache keyed on
 * `(conversationId, workspaceId, workspacePath)` so two iterations of
 * the same run inside that window would share a stale timestamp. Real-
 * time is the whole point of this surface, so it stays alongside
 * `runStateXml` as a per-iteration positional argument to
 * `buildSystemPrompt`.
 *
 * Field selection — chosen for actionability, not exhaustiveness:
 *   - `now_utc` / `local_time` (with IANA tz + numeric offset) /
 *     `day_of_week` — anchors any "today / yesterday / this week /
 *     last Thursday" reasoning. The agent should NEVER guess or
 *     hardcode a date; it reads it here.
 *   - `platform` / `os_release` / `arch` — so the agent picks
 *     `Get-ChildItem` vs `ls`, `\` vs `/`, `.ps1` vs `.sh`, etc.,
 *     without having to call `bash uname` first.
 *   - `node_version` / `electron_version` — informs which Node /
 *     Electron APIs are available when the agent reasons about
 *     scripting the host.
 *   - `locale` — informs date-format and number-format expectations
 *     the agent should match in user-facing prose.
 *
 * Excluded by design (Prime Directives §9 privacy + non-actionability):
 *   - `os.userInfo()` / `os.hostname()` / home-dir paths — PII the
 *     LLM provider does not need.
 *   - `os.cpus()[0].model` / total memory / load average — not
 *     actionable by the model and bulks the envelope.
 *   - Any network / interface info — out of scope.
 *
 * Rebuilt fresh each orchestrator iteration alongside `<run_state>` so
 * `bash` on Windows can use Get-ChildItem / `\` paths / `.ps1` without
 * an extra `uname` probe round-trip.
 */

import os from 'node:os';
import process from 'node:process';
import { wrapXml } from '../envelope/index.js';

/**
 * Render `Date.prototype.getTimezoneOffset()` (which returns minutes
 * WEST of UTC, so IST is `-330`) as the conventional `+HH:MM` / `-HH:MM`
 * shape the model is trained to read. Pure function — no globals.
 */
function formatOffset(offsetMinutes: number): string {
  // Flip the sign: getTimezoneOffset says "minutes west", humans say
  // "+05:30 east of UTC". Without the flip, IST would render as
  // `-05:30` which contradicts every locale convention the model has
  // seen in training.
  const totalMin = -offsetMinutes;
  const sign = totalMin >= 0 ? '+' : '-';
  const abs = Math.abs(totalMin);
  const hh = String(Math.floor(abs / 60)).padStart(2, '0');
  const mm = String(abs % 60).padStart(2, '0');
  return `${sign}${hh}:${mm}`;
}

/**
 * Resolve the runtime IANA timezone name (e.g. `Asia/Kolkata`,
 * `America/Los_Angeles`). Falls back to `UTC` on the rare host where
 * `Intl` is unavailable so the envelope shape stays stable.
 */
function resolveTimezone(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return tz && tz.length > 0 ? tz : 'UTC';
  } catch {
    return 'UTC';
  }
}

/**
 * Resolve the runtime locale (e.g. `en-IN`, `en-US`). Falls back to
 * `en-US` on Intl-unavailable hosts.
 */
function resolveLocale(): string {
  try {
    const loc = Intl.DateTimeFormat().resolvedOptions().locale;
    return loc && loc.length > 0 ? loc : 'en-US';
  } catch {
    return 'en-US';
  }
}

/**
 * Render the `Date` in the host's local timezone as
 * `YYYY-MM-DD HH:MM:SS`. The IANA tz name is appended separately by
 * the envelope so this helper stays pure (no `Intl.DateTimeFormat`
 * locale-dependent ordering surprises).
 */
function formatLocalClock(now: Date): string {
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const HH = String(now.getHours()).padStart(2, '0');
  const MM = String(now.getMinutes()).padStart(2, '0');
  const SS = String(now.getSeconds()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${HH}:${MM}:${SS}`;
}

/**
 * English weekday names. Locale-independent on purpose: the field is
 * read by the model, not the user, and the locale is surfaced in a
 * separate `locale:` line for any user-facing prose that needs to
 * match the user's region.
 */
const WEEKDAYS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday'
] as const;

/**
 * Build the `<host_environment>` envelope. `now` is parameterised so
 * tests can pin a deterministic timestamp; production calls pass no
 * argument and get a fresh `new Date()` each time.
 *
 * Every `os.*` / `process.*` read is individually try/caught — a
 * sandboxed runtime that strips one of them must not take down the
 * whole envelope (and in turn the system prompt, which is on the hot
 * path of every iteration). Each failure substitutes `'unknown'` so
 * the line shape stays stable.
 */
export function buildHostEnvironmentXml(now: Date = new Date()): string {
  let osPlatform: string;
  let osRelease: string;
  let osArch: string;
  try {
    osPlatform = process.platform;
  } catch {
    osPlatform = 'unknown';
  }
  try {
    osRelease = os.release();
  } catch {
    osRelease = 'unknown';
  }
  try {
    osArch = process.arch;
  } catch {
    osArch = 'unknown';
  }

  const nodeVersion =
    typeof process.versions?.node === 'string' ? process.versions.node : 'unknown';
  // Electron is only present in the bundled Electron main process; in
  // unit tests under Vitest we run on bare Node so the line is omitted
  // rather than rendered as `unknown`. Two stable shapes — production
  // (Electron present) and test (line absent) — both pinned by the
  // matching unit test.
  const electronVersion =
    typeof process.versions?.electron === 'string' ? process.versions.electron : null;

  const offset = formatOffset(now.getTimezoneOffset());
  const tz = resolveTimezone();
  const locale = resolveLocale();
  const day = WEEKDAYS[now.getDay()] ?? 'Unknown';

  const lines: string[] = [
    `now_utc: ${now.toISOString()}`,
    `local_time: ${formatLocalClock(now)} ${offset} (${tz})`,
    `day_of_week: ${day}`,
    `platform: ${osPlatform}`,
    `os_release: ${osRelease}`,
    `arch: ${osArch}`,
    `node_version: ${nodeVersion}`
  ];
  if (electronVersion !== null) {
    lines.push(`electron_version: ${electronVersion}`);
  }
  lines.push(`locale: ${locale}`);

  return wrapXml('host_environment', lines.join('\n'));
}
