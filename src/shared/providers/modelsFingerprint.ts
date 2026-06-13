/**
 * Shallow fingerprint for model-list change detection (discovery poller).
 */

import type { ModelInfo } from '../types/provider.js';

export function modelsFingerprint(models: ModelInfo[]): string {
  return JSON.stringify(
    models.map((m) => ({
      id: m.id,
      contextWindow: m.contextWindow,
      contextEstimated: m.contextEstimated,
      pricing: m.pricing,
      thinking: m.thinking
    }))
  );
}
