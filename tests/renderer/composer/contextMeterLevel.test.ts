import { describe, expect, it } from 'vitest';
import {
  evaluationScopeKey,
  liveUsageMatchesModel,
  modelSelectionKey
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
      settingsKey: '0.9:200000:0.7:0.75'
    };
    expect(evaluationScopeKey(base)).not.toBe(
      evaluationScopeKey({ ...base, model: modelB })
    );
    expect(evaluationScopeKey(base)).not.toBe(
      evaluationScopeKey({ ...base, settingsKey: '1:200000:0.7:0.75' })
    );
  });

  it('liveUsageMatchesModel requires tagged model when idle', () => {
    const event = {
      kind: 'context-usage' as const,
      id: '1',
      ts: 0,
      usedTokens: 1000,
      effectiveWindow: 200_000,
      advertisedWindow: 262_100,
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
      effectiveWindow: 200_000,
      advertisedWindow: 262_100,
      level: 'ok' as const,
      exact: false
    };
    expect(liveUsageMatchesModel(event, modelA, true)).toBe(true);
    expect(liveUsageMatchesModel(event, modelA, false)).toBe(false);
  });
});
