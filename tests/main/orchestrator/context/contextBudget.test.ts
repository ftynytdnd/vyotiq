import { describe, expect, it, vi } from 'vitest';
import { evaluateContextBudget } from '@main/orchestrator/context/contextBudget';
import { sumContextBreakdown } from '@shared/context/contextLevel';
import { DEFAULT_CONTEXT_MANAGEMENT_SETTINGS } from '@shared/settings/agentBehaviorSettings';
import { getProviderWithKey } from '@main/providers/providerStore.js';

vi.mock('@main/providers/providerStore.js', () => ({
  getProviderWithKey: vi.fn(async () => ({
    id: 'test',
    name: 'Test',
    models: [{ id: 'm1', contextWindow: 128_000 }],
    contextOverrides: {}
  }))
}));

vi.mock('@main/providers/tokenCountRemote.js', () => ({
  providerSupportsRemoteCount: () => false,
  getCachedRemoteCount: () => undefined,
  refineRemoteCount: vi.fn()
}));

vi.mock('@main/providers/tokenCounter.js', () => ({
  tokenizeMessages: vi.fn(() => ({
    total: 10_000,
    exact: false,
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
});
