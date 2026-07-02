import { describe, expect, it } from 'vitest';
import { CLAUDE_CODE_PROXY_RECOMMENDED_MODELS } from '@shared/providers/claudeCodeProxy.js';

describe('claudeCodeProxy fallback catalog enrichment', () => {
  it('recommended models always ship context windows for offline fallback', () => {
    expect(CLAUDE_CODE_PROXY_RECOMMENDED_MODELS.length).toBeGreaterThan(0);
    for (const model of CLAUDE_CODE_PROXY_RECOMMENDED_MODELS) {
      expect(model.contextWindow).toBeGreaterThan(0);
    }
  });
});
