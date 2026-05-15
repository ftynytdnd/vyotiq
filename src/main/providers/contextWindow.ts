/**
 * Main-process resolver for a (providerId, modelId) effective context
 * window. Reads the persisted provider list and applies the same
 * precedence as the renderer's pill (`@shared/providers/contextWindow`):
 *
 *   1. User-pinned override on the provider.
 *   2. Discovered value from `/v1/models`.
 *   3. `undefined`.
 *
 * Used by the run-loop's per-turn token-budget enforcement (Audit fix
 * §2.3). Returning `undefined` is a "trim disabled" signal — the
 * orchestrator won't shrink history when the host doesn't know the
 * window.
 */

import { listProviders } from './providerStore.js';
import { selectEffectiveContextWindow } from '@shared/providers/contextWindow.js';

export async function getEffectiveContextWindow(
  providerId: string,
  modelId: string
): Promise<number | undefined> {
  const providers = await listProviders();
  return selectEffectiveContextWindow(providers, providerId, modelId);
}
