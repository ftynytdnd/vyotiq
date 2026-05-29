/**
 * Regression for audit finding 1.3 — a corrupt `index.json` must NOT
 * silently erase the user's conversation history.
 *
 * Pre-fix behavior: `loadIndex` caught every non-ENOENT error and
 * defaulted `indexCache = []`. The next `flushIndex` would then write
 * `[]` over the (potentially recoverable) corrupt file via the `.tmp +
 * rename` path, permanently destroying the dock index. The post-fix
 * contract: the unreadable file is quarantine-renamed to
 * `index.json.corrupt-<ts>` BEFORE the empty cache is accepted, and
 * only THEN does the store start fresh.
 *
 * We can't easily reset the module-level caches between tests, so we
 * use a freshly-isolated `userData` path by reloading the
 * `conversationStore` module. Vitest's `vi.resetModules()` + a
 * re-mocked `electron.app.getPath` gives us that isolation cheaply.
 */

import { describe, expect, it, beforeEach, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

async function freshStore() {
  // Point `app.getPath('userData')` at a brand-new temp dir so the
  // module-level `baseDir` / `indexCache` caches can't bleed across
  // tests — each test resolves its own conversations dir.
  const userData = await fs.mkdtemp(join(tmpdir(), 'vyotiq-quarantine-'));
  vi.resetModules();
  vi.doMock('electron', async () => {
    const actual = await vi.importActual<typeof import('electron')>('electron');
    return {
      ...actual,
      app: { ...actual.app, getPath: () => userData }
    };
  });
  const mod = await import('@main/conversations/conversationStore');
  const baseDir = join(userData, 'vyotiq', 'conversations');
  return { mod, userData, baseDir };
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.doUnmock('electron');
});

// `freshStore()` resets modules and dynamically imports conversationStore
// (heavy graph: workspace, checkpoints, logger). Cold import often exceeds
// Vitest's default 5s when this file runs alone or under load.
describe('conversationStore — corrupt index quarantine', { timeout: 15_000 }, () => {
  it('quarantine-renames a corrupt index.json and starts empty', async () => {
    const { mod, baseDir } = await freshStore();
    await fs.mkdir(baseDir, { recursive: true });
    const indexPath = join(baseDir, 'index.json');
    // Write a deliberately unparseable blob — a torn write from a
    // crash mid-flush is the realistic failure mode.
    await fs.writeFile(indexPath, '{"id":"a","title":"boom"', 'utf8');

    const list = await mod.listConversations();
    expect(list).toEqual([]);

    // The corrupt file must have been moved out of the way BEFORE the
    // empty cache was accepted — otherwise a future flush would stomp
    // over the original payload and we'd lose the user's history for
    // good. We don't know the exact timestamp suffix, so enumerate.
    const entries = await fs.readdir(baseDir);
    const quarantined = entries.find((e) => e.startsWith('index.json.corrupt-'));
    expect(quarantined).toBeTruthy();
    // The quarantined copy preserves the original bytes verbatim —
    // support can diff the raw payload on bug reports.
    const preserved = await fs.readFile(join(baseDir, quarantined!), 'utf8');
    expect(preserved).toBe('{"id":"a","title":"boom"');
  });

  it('ENOENT (index never written) is NOT treated as corruption', async () => {
    const { mod, baseDir } = await freshStore();
    // Don't create index.json at all — `listConversations` should
    // lazily create the directory and return an empty list without
    // leaving a `.corrupt-*` sibling behind.
    const list = await mod.listConversations();
    expect(list).toEqual([]);
    const entries = await fs.readdir(baseDir).catch(() => [] as string[]);
    expect(entries.some((e) => e.startsWith('index.json.corrupt-'))).toBe(false);
  });
});
