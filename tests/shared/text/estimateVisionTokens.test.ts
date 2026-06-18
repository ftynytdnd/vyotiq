import { describe, expect, it } from 'vitest';
import {
  estimateImageTokensFromDimensions,
  estimateVisionTokensFromContent
} from '@shared/text/estimateVisionTokens.js';

describe('estimateVisionTokens', () => {
  it('scales with image dimensions', () => {
    const small = estimateImageTokensFromDimensions(256, 256);
    const large = estimateImageTokensFromDimensions(1024, 1024);
    expect(large).toBeGreaterThan(small);
  });

  it('estimates tokens from prepared content parts', () => {
    const tinyPng =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    const tokens = estimateVisionTokensFromContent([
      { type: 'image_url', image_url: { url: tinyPng } }
    ]);
    expect(tokens).toBeGreaterThanOrEqual(85);
  });
});
