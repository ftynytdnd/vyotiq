/**
 * Pins the `<host_environment>` envelope shape. This block is read by
 * the orchestrator on every iteration so the model can give correct
 * time-relative answers and pick OS-appropriate tool invocations
 * without having to probe.
 *
 * Field-order and line-shape stability matter — the harness prose in
 * `02-context-and-memory.md` §A names the keys (`now_utc`,
 * `local_time`, `day_of_week`, `platform`, `os_release`, `arch`,
 * `node_version`, `electron_version`, `locale`) and the model is
 * trained to pattern-match them. A silent rename here would break
 * that contract.
 */

import { describe, expect, it } from 'vitest';
import { buildHostEnvironmentXml } from '@main/orchestrator/loop/buildHostEnvironment';

describe('buildHostEnvironmentXml', () => {
  it('wraps the body in a <host_environment>…</host_environment> envelope', () => {
    const xml = buildHostEnvironmentXml(new Date('2026-05-18T17:22:31.123Z'));
    expect(xml.startsWith('<host_environment>')).toBe(true);
    expect(xml.endsWith('</host_environment>')).toBe(true);
  });

  it('emits the required keys in a stable order', () => {
    const xml = buildHostEnvironmentXml(new Date('2026-05-18T17:22:31.123Z'));
    const body = xml
      .replace(/^<host_environment>\n/, '')
      .replace(/\n<\/host_environment>$/, '');
    const lines = body.split('\n');
    // Keys must appear in this order, because the model is
    // pattern-matching on the line-prefix shape.
    const keys = lines.map((l) => l.split(':')[0]);
    expect(keys[0]).toBe('now_utc');
    expect(keys[1]).toBe('local_time');
    expect(keys[2]).toBe('day_of_week');
    expect(keys[3]).toBe('platform');
    expect(keys[4]).toBe('os_release');
    expect(keys[5]).toBe('arch');
    expect(keys[6]).toBe('node_version');
    // `electron_version` is conditional on the runtime; the locale
    // key always closes the block (last line).
    expect(keys[keys.length - 1]).toBe('locale');
  });

  it('renders now_utc as a strict ISO-8601 UTC timestamp', () => {
    const fixed = new Date('2026-05-18T17:22:31.123Z');
    const xml = buildHostEnvironmentXml(fixed);
    expect(xml).toContain('now_utc: 2026-05-18T17:22:31.123Z');
  });

  it('renders day_of_week from the host-local Date.getDay()', () => {
    // 2026-05-18 was a Monday. The line uses the host's local-day
    // mapping, which for any host within ±12 hours of UTC will
    // resolve to either "Monday" or "Sunday" / "Tuesday" if the
    // local clock is already across the day boundary. We accept
    // any English weekday so the test stays portable across CI
    // hosts in different timezones.
    const xml = buildHostEnvironmentXml(new Date('2026-05-18T12:00:00Z'));
    expect(xml).toMatch(/day_of_week: (Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday)/);
  });

  it('renders local_time with the conventional +HH:MM / -HH:MM offset and an IANA timezone in parentheses', () => {
    const xml = buildHostEnvironmentXml(new Date('2026-05-18T17:22:31.123Z'));
    // Shape: `local_time: YYYY-MM-DD HH:MM:SS ±HH:MM (IANA/Zone)`
    // The `±` is one of `+` or `-`. The IANA zone is whatever the
    // host's `Intl.DateTimeFormat().resolvedOptions().timeZone`
    // returns; under Vitest this is typically the test runner's
    // host zone or `UTC`.
    expect(xml).toMatch(
      /local_time: \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} [+-]\d{2}:\d{2} \([^\)]+\)/
    );
  });

  it('renders platform / arch as non-empty strings (host-resolved)', () => {
    const xml = buildHostEnvironmentXml(new Date());
    // `process.platform` is one of the documented Node platforms;
    // any non-empty string is acceptable for this assertion since
    // the field is host-resolved at call time.
    expect(xml).toMatch(/platform: \S+/);
    expect(xml).toMatch(/arch: \S+/);
    expect(xml).toMatch(/os_release: \S+/);
  });

  it('renders a non-empty node_version line', () => {
    const xml = buildHostEnvironmentXml(new Date());
    // Test runtime is bare Node so `process.versions.node` is
    // always present.
    expect(xml).toMatch(/node_version: \d+\.\d+/);
  });

  it('omits electron_version when not running inside Electron (test runtime)', () => {
    const xml = buildHostEnvironmentXml(new Date());
    // Vitest runs on bare Node, never Electron, so the field
    // must be absent. (In production the bundled main process
    // sets `process.versions.electron` and the line appears.)
    if (typeof (process.versions as Record<string, string | undefined>).electron === 'string') {
      // Defensive: if a future test runner DOES set electron,
      // assert the line shape rather than skipping silently.
      expect(xml).toMatch(/electron_version: \S+/);
    } else {
      expect(xml).not.toContain('electron_version:');
    }
  });

  it('renders a non-empty locale line as the last field', () => {
    const xml = buildHostEnvironmentXml(new Date());
    // `Intl.DateTimeFormat().resolvedOptions().locale` is host-
    // resolved; any well-formed BCP-47 tag (`en-US`, `en-IN`, etc.)
    // is acceptable. The fallback is `en-US`.
    expect(xml).toMatch(/locale: [a-zA-Z]{2,}(-[a-zA-Z0-9]{2,})*/);
    // The locale line is always the last — assert by suffix shape.
    expect(xml).toMatch(/locale: [^\n]+\n<\/host_environment>$/);
  });

  it('produces a fresh timestamp on every call (no internal cache)', () => {
    // Real-time is the entire point of this surface; any cache
    // would defeat it. Two consecutive calls without an explicit
    // `now` argument must produce different `now_utc` lines once
    // the wall clock has advanced (here we sleep ~5ms via a
    // micro-busy-wait so the test stays deterministic without
    // pulling in fake timers).
    const a = buildHostEnvironmentXml();
    const start = Date.now();
    while (Date.now() - start < 5) {
      // micro-busy-wait
    }
    const b = buildHostEnvironmentXml();
    // Same envelope shape, different timestamp — extract the
    // `now_utc:` line from each and confirm they are distinct
    // when at least 1ms has passed.
    const extract = (xml: string): string =>
      xml.split('\n').find((l) => l.startsWith('now_utc:')) ?? '';
    expect(extract(a)).not.toBe(extract(b));
  });

  it('defaults `now` to the current Date when no argument is supplied', () => {
    const before = Date.now();
    const xml = buildHostEnvironmentXml();
    const after = Date.now();
    const match = xml.match(/now_utc: ([^\n]+)/);
    expect(match).toBeTruthy();
    const ts = Date.parse(match![1]!);
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });
});
