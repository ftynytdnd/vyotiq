import { describe, expect, it, vi } from 'vitest';
import { evaluateContextBudget } from '@main/orchestrator/context/contextBudget';
import { sumContextBreakdown } from '@shared/context/contextLevel';
import { DEFAULT_CONTEXT_MANAGEMENT_SETTINGS } from '@shared/settings/agentBehaviorSettings';
import { getProviderWithKey } from '@main/providers/providerStore.js';
import * as tokenCountRemote from '@main/providers/tokenCountRemote.js';

vi.mock('@main/providers/providerStore.js', () => ({
  getProviderWithKey: vi.fn(async () => ({
    id: 'test',
    name: 'Test',
    models: [{ id: 'm1', contextWindow: 128_000 }],
    contextOverrides: {}
  }))
}));

vi.mock('@main/providers/tokenCountRemote.js', () => ({
  providerSupportsRemoteCount: vi.fn(() => false),
  getCachedRemoteCount: vi.fn(() => undefined),
  refineRemoteCount: vi.fn()
}));

vi.mock('@main/providers/tokenCounter.js', () => ({
  tokenizeMessages: vi.fn(() => ({
    total: 10_000,
    exact: false,
    visionTokens: 0,
    breakdown: {
      system: 5_000,
      fewShot: 1_000,
      workspace: 500,
      history: 2_000,
      runtime: 1_000,
      turn: 300,
      tools: 200
    }
  }))
}));

describe('evaluateContextBudget', () => {
  it('applies calibration and reconciles breakdown to calibrated usedTokens', async () => {
    const usage = await evaluateContextBudget({
      messages: [{ role: 'user', content: 'hello' }],
      modelId: 'm1',
      providerId: 'test',
      settings: DEFAULT_CONTEXT_MANAGEMENT_SETTINGS,
      calibrationRatio: 1.2,
      skipRemoteRefine: true
    });
    expect(usage.usedTokens).toBe(12_000);
    expect(usage.exact).toBe(true);
    expect(usage.breakdown).toBeDefined();
    expect(sumContextBreakdown(usage.breakdown!)).toBe(12_000);
  });

  it('uses the full discovered context window without artificial caps', async () => {
    const usage = await evaluateContextBudget({
      messages: [{ role: 'user', content: 'hello' }],
      modelId: 'm1',
      providerId: 'test',
      settings: DEFAULT_CONTEXT_MANAGEMENT_SETTINGS,
      skipRemoteRefine: true
    });
    expect(usage.effectiveWindow).toBe(128_000);
    expect(usage.advertisedWindow).toBe(128_000);
  });

  it('returns zero window when provider or model context is unknown', async () => {
    vi.mocked(getProviderWithKey).mockResolvedValueOnce(null);
    const usage = await evaluateContextBudget({
      messages: [{ role: 'user', content: 'hello' }],
      modelId: 'm1',
      providerId: 'missing',
      settings: DEFAULT_CONTEXT_MANAGEMENT_SETTINGS,
      skipRemoteRefine: true
    });
    expect(usage.effectiveWindow).toBe(0);
    expect(usage.advertisedWindow).toBe(0);
  });

  it('includes visionTokens in remote count cache key and used total', async () => {
    const { tokenizeMessages } = await import('@main/providers/tokenCounter.js');
    vi.mocked(tokenizeMessages).mockReturnValueOnce({
      total: 10_000,
      exact: false,
      visionTokens: 1_500,
      breakdown: {
        system: 0,
        fewShot: 0,
        workspace: 0,
        history: 10_000,
        runtime: 0,
        turn: 0,
        tools: 0
      }
    });
    vi.mocked(getProviderWithKey).mockResolvedValueOnce({
      id: 'anthropic',
      name: 'Anthropic',
      dialect: 'anthropic-native',
      models: [{ id: 'claude', contextWindow: 200_000 }],
      contextOverrides: {}
    } as Awaited<ReturnType<typeof getProviderWithKey>>);
    vi.mocked(tokenCountRemote.providerSupportsRemoteCount).mockReturnValue(true);
    vi.mocked(tokenCountRemote.getCachedRemoteCount).mockReturnValue(8_000);

    const usage = await evaluateContextBudget({
      messages: [{ role: 'user', content: 'hello' }],
      modelId: 'claude',
      providerId: 'anthropic',
      settings: DEFAULT_CONTEXT_MANAGEMENT_SETTINGS,
      skipRemoteRefine: true
    });

    expect(tokenCountRemote.getCachedRemoteCount).toHaveBeenCalledWith(
      'anthropic',
      'claude',
      expect.any(String),
      1_500
    );
    expect(usage.usedTokens).toBe(9_500);
    expect(usage.visionTokens).toBe(1_500);
  });
});
