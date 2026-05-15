/**
 * Provider IPC. CRUD + dynamic /v1/models discovery + connectivity test.
 */

import { IPC } from '@shared/constants.js';
import type { AddProviderInput, ProviderAttribution } from '@shared/types/provider.js';
import {
  addProvider,
  listProviders,
  removeProvider,
  setContextOverride,
  updateProvider
} from '../providers/providerStore.js';
import { detectDialect, discoverModels, testProvider } from '../providers/modelDiscovery.js';
import { logger } from '../logging/logger.js';
import { wrapIpcHandler } from './wrapIpcHandler.js';

const log = logger.child('ipc/providers');

export function registerProvidersIpc(): void {
  wrapIpcHandler(IPC.PROVIDERS_LIST, async () => listProviders());

  wrapIpcHandler(IPC.PROVIDERS_ADD, async (_event, input: AddProviderInput) => {
    // If the renderer didn't supply a dialect, auto-detect one BEFORE
    // creating the persisted record so the initial discovery call
    // below hits the right endpoint. Failure here is non-fatal: we
    // fall back to the renderer's implicit `openai` default, which
    // matches the pre-dialect behavior.
    let effective = input;
    if (!effective.dialect) {
      try {
        const detected = await detectDialect(input.baseUrl, input.apiKey);
        effective = { ...input, dialect: detected };
        log.info('dialect auto-detected', { baseUrl: input.baseUrl, dialect: detected });
      } catch (err) {
        log.warn('dialect auto-detect failed; defaulting to openai', {
          baseUrl: input.baseUrl,
          err
        });
      }
    }

    const created = await addProvider(effective);
    // Best-effort discovery; non-fatal if it fails.
    try {
      const models = await discoverModels(created.id, true);
      return { ...created, models };
    } catch (err) {
      log.warn('discovery failed after add', { providerId: created.id, err });
      return created;
    }
  });

  wrapIpcHandler(
    IPC.PROVIDERS_UPDATE,
    async (
      _event,
      id: string,
      // Patch accepts the same fields as `AddProviderInput` plus a few
      // settings-only flags (`enabled`, `attribution`) that aren't part
      // of the add-time payload. `attribution` is the OpenRouter
      // HTTP-Referer / X-OpenRouter-Title overrides; see
      // `ProviderConfig.attribution`. The store-side `updateProvider`
      // owns merge semantics.
      patch: Partial<AddProviderInput> & {
        enabled?: boolean;
        attribution?: ProviderAttribution;
      }
    ) => updateProvider(id, patch)
  );

  wrapIpcHandler(IPC.PROVIDERS_REMOVE, async (_event, id: string) => removeProvider(id));

  // Discovery — `force` defaults true (the renderer button is "Refresh"), but
  // callers can pass false to honor the in-process TTL cache.
  wrapIpcHandler(
    IPC.PROVIDERS_DISCOVER_MODELS,
    async (_event, id: string, force?: boolean) => discoverModels(id, force ?? true)
  );

  wrapIpcHandler(IPC.PROVIDERS_TEST, async (_event, id: string) => testProvider(id));

  wrapIpcHandler(
    IPC.PROVIDERS_SET_CONTEXT_OVERRIDE,
    async (_event, providerId: string, modelId: string, value: number | null) =>
      setContextOverride(providerId, modelId, value)
  );
}
