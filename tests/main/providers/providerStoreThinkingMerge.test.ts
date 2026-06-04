/**
 * `updateProvider` must merge per-model thinking-effort overrides (and
 * the previously-dropped `anthropicThinking` / `contextOverrides`)
 * rather than discarding them on patch.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';

// In-memory encrypted store backing — the provider store caches across
// calls, which is fine within a single test sequence.
let store: unknown[] = [];

vi.mock('@main/secrets/safeStore', () => ({
  readEncryptedJson: vi.fn(async () => store),
  writeEncryptedJson: vi.fn(async (_file: string, list: unknown[]) => {
    store = list;
  })
}));

import { addProvider, updateProvider } from '@main/providers/providerStore';

beforeEach(() => {
  store = [];
});

describe('updateProvider — thinking config merge', () => {
  it('shallow-merges modelThinking so other models survive', async () => {
    const created = await addProvider({
      name: 'DeepSeek',
      baseUrl: 'https://api.deepseek.com',
      apiKey: 'sk-test',
      dialect: 'openai'
    });

    await updateProvider(created.id, {
      modelThinking: { 'deepseek-v4-flash': 'high' }
    });
    const afterFirst = await updateProvider(created.id, {
      modelThinking: { 'deepseek-v4-pro': 'off' }
    });

    // Both models' overrides coexist after two single-key patches.
    expect(afterFirst.modelThinking).toEqual({
      'deepseek-v4-flash': 'high',
      'deepseek-v4-pro': 'off'
    });
  });

  it('clears a model override when patch value is null', async () => {
    const created = await addProvider({
      name: 'DeepSeek',
      baseUrl: 'https://api.deepseek.com',
      apiKey: 'sk-test',
      dialect: 'openai'
    });
    await updateProvider(created.id, {
      modelThinking: { 'deepseek-v4-flash': 'high', 'deepseek-v4-pro': 'off' }
    });
    const cleared = await updateProvider(created.id, {
      modelThinking: { 'deepseek-v4-flash': null }
    });
    expect(cleared.modelThinking).toEqual({ 'deepseek-v4-pro': 'off' });
  });

  it('preserves modelThinking when a patch does not touch it', async () => {
    const created = await addProvider({
      name: 'DeepSeek',
      baseUrl: 'https://api.deepseek.com',
      apiKey: 'sk-test',
      dialect: 'openai'
    });
    await updateProvider(created.id, { modelThinking: { 'deepseek-v4-flash': 'medium' } });

    const afterRename = await updateProvider(created.id, { name: 'DeepSeek Direct' });
    expect(afterRename.name).toBe('DeepSeek Direct');
    expect(afterRename.modelThinking).toEqual({ 'deepseek-v4-flash': 'medium' });
  });

  it('persists the previously-dropped anthropicThinking + contextOverrides', async () => {
    const created = await addProvider({
      name: 'Anthropic',
      baseUrl: 'https://api.anthropic.com',
      apiKey: 'sk-test',
      dialect: 'anthropic-native'
    });

    const updated = await updateProvider(created.id, {
      anthropicThinking: { enabled: true, effort: 'high' },
      contextOverrides: { 'claude-opus-4-7': 200000 }
    });

    expect(updated.anthropicThinking).toEqual({ enabled: true, effort: 'high' });
    expect(updated.contextOverrides).toEqual({ 'claude-opus-4-7': 200000 });
  });
});
