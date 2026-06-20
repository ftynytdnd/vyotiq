import { describe, expect, it } from 'vitest';
import {
  inputModalitiesFromModelId,
  inputModalitiesFromOpenRouterArchitecture,
  modelSupportsVision,
  normalizeInputModalities,
  resolveInputModalitiesFromDiscovery
} from '@shared/providers/visionCapabilities.js';

describe('visionCapabilities', () => {
  it('normalizes OpenRouter architecture input_modalities', () => {
    expect(
      inputModalitiesFromOpenRouterArchitecture({
        input_modalities: ['text', 'image', 'file']
      })
    ).toEqual(['text', 'image', 'file']);
  });

  it('detects vision from model id heuristics', () => {
    expect(modelSupportsVision(inputModalitiesFromModelId('openai/gpt-4o'))).toBe(true);
    expect(inputModalitiesFromModelId('meta/llama-3.2-11b-vision-instruct')).toContain(
      'image'
    );
  });

  it('normalizeInputModalities always includes text', () => {
    expect(normalizeInputModalities(['image'])).toEqual(['text', 'image']);
  });

  it('resolveInputModalitiesFromDiscovery prefers API sources over model-id heuristics', () => {
    expect(
      resolveInputModalitiesFromDiscovery('vendor/gpt-4o', ['text'], undefined)
    ).toEqual({ inputModalities: ['text'] });
    expect(
      resolveInputModalitiesFromDiscovery('vendor/gpt-4o')
    ).toEqual({
      inputModalities: ['text', 'image', 'file'],
      inputModalitiesEstimated: true
    });
  });
});
