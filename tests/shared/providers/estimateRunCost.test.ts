import { describe, expect, it } from 'vitest';
import { estimateRunCost, formatComposerCostUsd, formatRunCostUsd } from '@shared/providers/estimateRunCost.js';

describe('estimateRunCost', () => {
  it('estimates input + output cost from per-million pricing', () => {
    const est = estimateRunCost(
      { promptTokens: 1_000_000, completionTokens: 500_000 },
      { inputPerMillion: 2, outputPerMillion: 10 }
    );
    expect(est?.totalUsd).toBeCloseTo(7, 4);
    expect(formatRunCostUsd(est!.totalUsd)).toBe('$7.00');
  });

  it('bills OpenAI-style cached tokens at cachedInputPerMillion', () => {
    const est = estimateRunCost(
      { promptTokens: 1_000_000, completionTokens: 0, cachedPromptTokens: 800_000 },
      { inputPerMillion: 2, outputPerMillion: 10, cachedInputPerMillion: 0.2 }
    );
    // 200k uncached @ $2/M + 800k cached @ $0.2/M = 0.4 + 0.16
    expect(est?.cachedInputUsd).toBeCloseTo(0.16, 4);
    expect(est?.totalUsd).toBeCloseTo(0.56, 4);
  });

  it('defaults cached read to 0.1× input when cachedInputPerMillion is omitted', () => {
    const est = estimateRunCost(
      { promptTokens: 1_000_000, completionTokens: 0, cachedPromptTokens: 1_000_000 },
      { inputPerMillion: 10, outputPerMillion: 30 }
    );
    expect(est?.cachedInputUsd).toBeCloseTo(1, 4);
    expect(est?.totalUsd).toBeCloseTo(1, 4);
  });

  it('bills Anthropic-style tail, cache read, and cache write separately', () => {
    const est = estimateRunCost(
      {
        promptTokens: 50_000,
        completionTokens: 10_000,
        cachedPromptTokens: 900_000,
        cacheCreationTokens: 50_000
      },
      {
        inputPerMillion: 3,
        outputPerMillion: 15,
        cachedInputPerMillion: 0.3,
        cacheWriteInputPerMillion: 3.75
      }
    );
    expect(est?.cachedInputUsd).toBeCloseTo(0.27, 4);
    expect(est?.cacheWriteUsd).toBeCloseTo(0.1875, 4);
    // 50k tail @ $3/M + cached + write
    expect(est?.inputUsd).toBeCloseTo(0.6075, 4);
    expect(est?.outputUsd).toBeCloseTo(0.15, 4);
    expect(est?.totalUsd).toBeCloseTo(0.7575, 4);
  });
});

describe('formatComposerCostUsd', () => {
  it('uses higher precision for sub-cent amounts', () => {
    expect(formatComposerCostUsd(0.0012)).toBe('$0.0012');
    expect(formatComposerCostUsd(0.00005)).toBe('$0.00005');
  });

  it('matches timeline formatter for dollar-scale amounts', () => {
    expect(formatComposerCostUsd(1.23)).toBe('$1.23');
    expect(formatComposerCostUsd(0.042)).toBe('$0.0420');
  });
});
