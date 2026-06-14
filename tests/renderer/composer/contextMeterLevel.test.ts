import { describe, expect, it } from 'vitest';
import {
  evaluationScopeKey,
  liveUsageMatchesModel,
  liveUsageWindowMatchesDiscovered,
  modelSelectionKey,
  resolveLiveAdvertisedWindow,
  summarizeLiveContextUsage
} from '@renderer/components/composer/contextMeterLevel';

const modelA = { providerId: 'ollama', modelId: 'gemma4:31b' };
const modelB = { providerId: 'ollama', modelId: 'deepseek-v4-pro' };

describe('contextMeterLevel helpers', () => {
  it('modelSelectionKey is stable per provider+model', () => {
    expect(modelSelectionKey(modelA)).toBe('ollama\0gemma4:31b');
    expect(modelSelectionKey(modelB)).not.toBe(modelSelectionKey(modelA));
  });

  it('evaluationScopeKey changes when model or settings key changes', () => {
    const base = {
      model: modelA,
      workspaceId: 'ws-1',
      conversationId: 'conv-1',
      settingsKey: '0.7:0.75'
    };
    expect(evaluationScopeKey(base)).not.toBe(
      evaluationScopeKey({ ...base, model: modelB })
    );
    expect(evaluationScopeKey(base)).not.toBe(
      evaluationScopeKey({ ...base, settingsKey: '1:0.75' })
    );
  });

  it('evaluationScopeKey changes when discovered context window changes', () => {
    const base = {
      model: modelA,
      workspaceId: 'ws-1',
      conversationId: 'conv-1',
      settingsKey: '0.7:0.75',
      contextWindow: 128_000
    };
    expect(evaluationScopeKey(base)).not.toBe(
      evaluationScopeKey({ ...base, contextWindow: 1_000_000 })
    );
  });

  it('liveUsageMatchesModel requires tagged model when idle', () => {
    const event = {
      kind: 'context-usage' as const,
      id: '1',
      ts: 0,
      usedTokens: 1000,
      effectiveWindow: 1_000_000,
      advertisedWindow: 1_000_000,
      level: 'ok' as const,
      exact: false
    };
    expect(liveUsageMatchesModel(event, modelA, false)).toBe(false);
    expect(
      liveUsageMatchesModel(
        { ...event, providerId: 'ollama', modelId: 'gemma4:31b' },
        modelA,
        false
      )
    ).toBe(true);
    expect(
      liveUsageMatchesModel(
        { ...event, providerId: 'ollama', modelId: 'gemma4:31b' },
        modelB,
        false
      )
    ).toBe(false);
  });

  it('liveUsageMatchesModel trusts untagged events only during active runs', () => {
    const event = {
      kind: 'context-usage' as const,
      id: '1',
      ts: 0,
      usedTokens: 1000,
      effectiveWindow: 1_000_000,
      advertisedWindow: 1_000_000,
      level: 'ok' as const,
      exact: false
    };
    expect(liveUsageMatchesModel(event, modelA, true)).toBe(true);
    expect(liveUsageMatchesModel(event, modelA, false)).toBe(false);
  });

  it('liveUsageWindowMatchesDiscovered rejects stale capped denominators', () => {
    const event = {
      kind: 'context-usage' as const,
      id: '1',
      ts: 0,
      usedTokens: 13_800,
      effectiveWindow: 200_000,
      advertisedWindow: 200_000,
      level: 'ok' as const,
      exact: true
    };
    expect(liveUsageWindowMatchesDiscovered(event, 1_000_000)).toBe(false);
    expect(liveUsageWindowMatchesDiscovered(event, 200_000)).toBe(true);
  });

  it('resolveLiveAdvertisedWindow prefers discovered window over stale event payload', () => {
    const event = {
      kind: 'context-usage' as const,
      id: '1',
      ts: 0,
      usedTokens: 13_800,
      effectiveWindow: 200_000,
      advertisedWindow: 200_000,
      level: 'ok' as const,
      exact: true
    };
    expect(resolveLiveAdvertisedWindow(event, 1_000_000)).toBe(1_000_000);
    expect(resolveLiveAdvertisedWindow(event, undefined)).toBe(200_000);
  });

  it('summarizeLiveContextUsage re-applies thresholds against the discovered window', () => {
    const event = {
      kind: 'context-usage' as const,
      id: '1',
      ts: 0,
      usedTokens: 190_000,
      effectiveWindow: 200_000,
      advertisedWindow: 200_000,
      level: 'trigger' as const,
      exact: true
    };
    const summary = summarizeLiveContextUsage(event, {
      advertisedWindow: 1_000_000,
      thresholds: { warnFraction: 0.7, triggerFraction: 0.75 }
    });
    expect(summary.effectiveWindow).toBe(1_000_000);
    expect(summary.fractionUsed).toBeCloseTo(0.19, 3);
    expect(summary.level).toBe('warn');
  });
});
