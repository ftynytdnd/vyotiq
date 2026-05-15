/**
 * `globalMeta.ts` tests. Covers:
 *   - First read seeds the file with the default template.
 *   - Subsequent reads return the persisted contents.
 *   - `appendGlobalMetaRule` produces a date-stamped line ending in \n.
 *   - `globalMetaFilePath` returns the on-disk location used by the
 *      Reveal-in-folder action.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import {
  appendGlobalMetaRule,
  globalMetaFilePath,
  readGlobalMetaRules,
  writeGlobalMetaRules
} from '@main/memory/globalMeta';

afterEach(async () => {
  // Reset the file between tests so each one starts from the same
  // baseline. The mocked userData dir is the same across tests because
  // the electron mock memoizes it.
  try {
    await fs.unlink(globalMetaFilePath());
  } catch {
    /* ENOENT — fine */
  }
});

describe('globalMeta', () => {
  it('readGlobalMetaRules seeds the default template on first read', async () => {
    const txt = await readGlobalMetaRules();
    expect(txt).toContain('Global Meta-Rules');
    // The seed includes the "Preferences" header.
    expect(txt).toMatch(/Preferences/);
  });

  it('writeGlobalMetaRules persists exact content', async () => {
    await writeGlobalMetaRules('# custom\n- rule one\n');
    const txt = await readGlobalMetaRules();
    expect(txt).toBe('# custom\n- rule one\n');
  });

  it('appendGlobalMetaRule adds a date-stamped bullet at the end', async () => {
    await writeGlobalMetaRules('# header\n');
    await appendGlobalMetaRule('Prefer TypeScript over JavaScript.');
    const txt = await readGlobalMetaRules();
    expect(txt.startsWith('# header')).toBe(true);
    // Must have a `- [YYYY-MM-DD] ...` bullet ending with newline.
    expect(txt).toMatch(/\n- \[\d{4}-\d{2}-\d{2}\] Prefer TypeScript over JavaScript\.\n$/);
  });

  it('globalMetaFilePath returns an absolute path under userData', async () => {
    const p = globalMetaFilePath();
    const { app } = await import('electron');
    expect(p.startsWith(app.getPath('userData'))).toBe(true);
    expect(p.endsWith('meta-rules.md')).toBe(true);
  });

  // Regression: `appendGlobalMetaRule` is read-modify-write. Without
  // serialization, two parallel callers (e.g. two sub-agents running in
  // the pool) both read the pre-state and the second write clobbers
  // the first, silently losing a rule. The fix chains every append
  // through a single process-wide promise so all N rules land.
  it('serializes parallel appends so every rule survives', async () => {
    await writeGlobalMetaRules('# header\n');
    const lines = Array.from({ length: 10 }, (_, i) => `parallel rule ${i}`);
    await Promise.all(lines.map((l) => appendGlobalMetaRule(l)));
    const txt = await readGlobalMetaRules();
    for (const l of lines) {
      expect(txt).toContain(l);
    }
    // And the file must still end with a single trailing newline.
    expect(txt.endsWith('\n')).toBe(true);
  });
});
