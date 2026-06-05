import { describe, expect, it } from 'vitest';
import { effectiveContextWindow, normalizeContextOverride } from '@shared/providers/contextWindow.js';

describe('contextWindow', () => {
  it('effectiveContextWindow prefers override without mutating discovered', () => {
    const model = { id: 'm', contextWindow: 128000 };
    expect(effectiveContextWindow(model, { m: 200000 })).toBe(200000);
    expect(model.contextWindow).toBe(128000);
    expect(effectiveContextWindow(model, {})).toBe(128000);
  });

  it('normalizeContextOverride rejects invalid values', () => {
    expect(normalizeContextOverride(128000)).toBe(128000);
    expect(normalizeContextOverride(0)).toBeUndefined();
    expect(normalizeContextOverride('nope')).toBeUndefined();
  });
});
