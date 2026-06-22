/**
 * `providerFileStore.load()` must degrade to an empty store (never throw)
 * when the backing JSON is missing, corrupt, or the wrong shape — but a
 * non-ENOENT failure must leave a log breadcrumb instead of silently
 * discarding every cached upload mapping.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';

let fileContent: string | null = null; // null => simulate ENOENT
const logWarn = vi.fn();

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(async () => {
    if (fileContent === null) {
      const err = new Error('no such file') as NodeJS.ErrnoException;
      err.code = 'ENOENT';
      throw err;
    }
    return fileContent;
  }),
  writeFile: vi.fn(async () => undefined),
  mkdir: vi.fn(async () => undefined)
}));

vi.mock('@main/paths/userDataLayout', () => ({
  vyotiqDataPath: (...segments: string[]) => segments.join('/') || '/tmp'
}));

vi.mock('@main/logging/logger.js', () => ({
  logger: {
    child: () => ({ warn: logWarn, debug: vi.fn(), error: vi.fn(), info: vi.fn() })
  }
}));

beforeEach(() => {
  vi.resetModules();
  fileContent = null;
  logWarn.mockClear();
});

describe('providerFileStore — load resilience', () => {
  it('returns undefined (no throw, no warn) for a missing store file', async () => {
    const { getStoredProviderFile } = await import('@main/providers/files/providerFileStore');

    await expect(getStoredProviderFile('p', 'h')).resolves.toBeUndefined();
    // ENOENT is the normal first-run case — must stay silent.
    expect(logWarn).not.toHaveBeenCalled();
  });

  it('degrades to empty and warns on malformed JSON', async () => {
    fileContent = '{ this is not valid json';
    const { getStoredProviderFile } = await import('@main/providers/files/providerFileStore');

    await expect(getStoredProviderFile('p', 'h')).resolves.toBeUndefined();
    expect(logWarn).toHaveBeenCalledTimes(1);
  });

  it('degrades to empty when JSON is valid but the wrong shape', async () => {
    fileContent = '{}'; // missing `entries[]`
    const { getStoredProviderFile } = await import('@main/providers/files/providerFileStore');

    // The shape guard prevents `data.entries.find` from throwing here.
    await expect(getStoredProviderFile('p', 'h')).resolves.toBeUndefined();
  });

  it('reads back a well-formed entry', async () => {
    fileContent = JSON.stringify({
      entries: [
        {
          providerId: 'p',
          contentHash: 'h',
          fileId: 'file-123',
          mime: 'image/png',
          uploadedAt: Date.now()
        }
      ]
    });
    const { getStoredProviderFile } = await import('@main/providers/files/providerFileStore');

    const hit = await getStoredProviderFile('p', 'h');
    expect(hit?.fileId).toBe('file-123');
    expect(logWarn).not.toHaveBeenCalled();
  });
});
