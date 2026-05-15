/**
 * `setContextOverride` tests. Verifies the store accepts a positive
 * integer, clears with `null` / non-positive / non-finite values, and
 * drops the `contextOverrides` key entirely when the last entry is
 * removed.
 */

import { describe, expect, it, vi, beforeAll } from 'vitest';
import { safeStorage } from 'electron';
import {
  addProvider,
  setContextOverride,
  listProviders
} from '@main/providers/providerStore';

// `safeStore.writeEncryptedJson` refuses to persist when the OS-level
// encryption is unavailable. In the main-process test harness the
// default Electron mock returns false. Override once for this file so
// provider writes succeed; the fake encryption round-trips the buffer
// as utf-8 which is fine for tests.
beforeAll(() => {
  vi.spyOn(safeStorage, 'isEncryptionAvailable').mockReturnValue(true);
});

// These tests share the main-project's module-level provider cache.
// Each test adds a provider with a freshly-generated UUID so there is
// no cross-contamination — we only ever look up by the new id.

describe('providerStore.setContextOverride', () => {
  it('pins a positive integer override and survives a re-list', async () => {
    const p = await addProvider({
      name: 'OpenAI',
      baseUrl: 'https://api.openai.com',
      apiKey: 'sk-test'
    });
    await setContextOverride(p.id, 'gpt-4o', 128_000);
    const list = await listProviders();
    const stored = list.find((x) => x.id === p.id);
    expect(stored?.contextOverrides).toEqual({ 'gpt-4o': 128_000 });
  });

  it('floors fractional inputs', async () => {
    const p = await addProvider({
      name: 'OpenAI',
      baseUrl: 'https://api.openai.com',
      apiKey: ''
    });
    await setContextOverride(p.id, 'gpt-4o', 128_000.9);
    const list = await listProviders();
    expect(list.find((x) => x.id === p.id)?.contextOverrides?.['gpt-4o']).toBe(128_000);
  });

  it('clears the override when value is null', async () => {
    const p = await addProvider({
      name: 'OpenAI',
      baseUrl: 'https://api.openai.com',
      apiKey: ''
    });
    await setContextOverride(p.id, 'gpt-4o', 128_000);
    await setContextOverride(p.id, 'gpt-4o', null);
    const list = await listProviders();
    expect(list.find((x) => x.id === p.id)?.contextOverrides).toBeUndefined();
  });

  it('treats non-finite or non-positive values as clears', async () => {
    const p = await addProvider({
      name: 'OpenAI',
      baseUrl: 'https://api.openai.com',
      apiKey: ''
    });
    await setContextOverride(p.id, 'gpt-4o', 128_000);
    await setContextOverride(p.id, 'gpt-4o', 0);
    const list = await listProviders();
    expect(list.find((x) => x.id === p.id)?.contextOverrides).toBeUndefined();

    await setContextOverride(p.id, 'gpt-4o', 128_000);
    await setContextOverride(p.id, 'gpt-4o', -5);
    const list2 = await listProviders();
    expect(list2.find((x) => x.id === p.id)?.contextOverrides).toBeUndefined();

    await setContextOverride(p.id, 'gpt-4o', 128_000);
    await setContextOverride(p.id, 'gpt-4o', Number.POSITIVE_INFINITY);
    const list3 = await listProviders();
    expect(list3.find((x) => x.id === p.id)?.contextOverrides).toBeUndefined();
  });

  it('keeps other entries when clearing a single one', async () => {
    const p = await addProvider({
      name: 'OpenAI',
      baseUrl: 'https://api.openai.com',
      apiKey: ''
    });
    await setContextOverride(p.id, 'gpt-4o', 128_000);
    await setContextOverride(p.id, 'gpt-4.1', 256_000);
    await setContextOverride(p.id, 'gpt-4o', null);
    const list = await listProviders();
    expect(list.find((x) => x.id === p.id)?.contextOverrides).toEqual({
      'gpt-4.1': 256_000
    });
  });

  it('throws when the provider id is unknown', async () => {
    await expect(setContextOverride('does-not-exist', 'gpt-4o', 128_000)).rejects.toThrow(
      /Provider not found/
    );
  });
});
