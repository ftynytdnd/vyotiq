/**
 * Playwright smoke — local claude-code-proxy provider (skipped when proxy offline).
 */

import { test, expect } from './fixtures/electron.fixture.js';

async function proxyHealthy(): Promise<boolean> {
  try {
    const res = await fetch('http://127.0.0.1:18765/healthz', {
      signal: AbortSignal.timeout(3_000)
    });
    if (!res.ok) return false;
    const json = (await res.json()) as { ok?: boolean };
    return json.ok === true;
  } catch {
    return false;
  }
}

test.describe('claude-code-proxy provider smoke', () => {
  test('lists Local subscription proxy provider when bridge is healthy', async ({
    window
  }) => {
    test.skip(!(await proxyHealthy()), 'claude-code-proxy not running on :18765');

    const providers = await window.evaluate(() => window.vyotiq.providers.list());
    const proxyProvider = providers.find(
      (p: { name: string; baseUrl: string }) =>
        p.name === 'Local subscription proxy' && p.baseUrl.includes('127.0.0.1')
    );
    expect(proxyProvider).toBeTruthy();
    expect((proxyProvider as { dialect?: string }).dialect).toBe('anthropic-native');
  });

  test('discovers cursor models through proxy provider', async ({ window }) => {
    test.skip(!(await proxyHealthy()), 'claude-code-proxy not running on :18765');

    const providers = await window.evaluate(() => window.vyotiq.providers.list());
    const proxyProvider = providers.find(
      (p: { name: string }) => p.name === 'Local subscription proxy'
    );
    expect(proxyProvider).toBeTruthy();

    const result = await window.evaluate(
      async (providerId: string) => window.vyotiq.providers.discoverModels(providerId, true),
      (proxyProvider as { id: string }).id
    );

    const ids = (result as { models: Array<{ id: string }> }).models.map((m) => m.id);
    expect(ids.some((id) => id.startsWith('cursor:'))).toBe(true);
  });
});
