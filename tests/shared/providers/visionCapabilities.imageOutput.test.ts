import { describe, expect, it } from 'vitest';
import { modelSupportsImageOutput } from '@shared/providers/visionCapabilities.js';

describe('modelSupportsImageOutput', () => {
  it('detects Gemini and OpenAI image-generation model ids', () => {
    expect(modelSupportsImageOutput('gemini-2.5-flash-image')).toBe(true);
    expect(modelSupportsImageOutput('gpt-image-1')).toBe(true);
    expect(modelSupportsImageOutput('gpt-4o')).toBe(false);
  });
});
