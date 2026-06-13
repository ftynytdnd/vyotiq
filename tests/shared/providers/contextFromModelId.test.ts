import { describe, expect, it } from 'vitest';
import { contextWindowFromModelId } from '@shared/providers/contextFromModelId.js';

describe('contextWindowFromModelId', () => {
  it('parses k suffix patterns', () => {
    expect(contextWindowFromModelId('qwen3-5-27b-128k-coding')).toBe(128_000);
    expect(contextWindowFromModelId('org/model-32k')).toBe(32_000);
  });

  it('parses million phrasing', () => {
    expect(contextWindowFromModelId('deepseek-1m-chat')).toBe(1_000_000);
  });

  it('returns undefined when no pattern matches', () => {
    expect(contextWindowFromModelId('gpt-4o')).toBeUndefined();
    expect(contextWindowFromModelId('llama-3.3-70b')).toBeUndefined();
  });
});
