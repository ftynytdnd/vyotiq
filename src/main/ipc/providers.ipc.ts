/**
 * Provider IPC. CRUD + dynamic /v1/models discovery + connectivity test.
 */

import { IPC } from '@shared/constants.js';
import type {
  AddProviderInput,
  ProviderAttribution,
  ThinkingEffort
} from '@shared/types/provider.js';
import {
  LEGACY_THINKING_EFFORT_MAX,
  THINKING_EFFORTS,
  normalizePersistedThinkingEffort
} from '@shared/providers/thinkingEffort.js';
import {
  addProvider,
  listProviders,
  removeProvider,
  updateProvider
} from '../providers/providerStore.js';
import { detectDialect, discoverModels, testProvider } from '../providers/modelDiscovery.js';
import { logger } from '../logging/logger.js';
import { wrapIpcHandler } from './wrapIpcHandler.js';
// Audit fix 2026-06-P2-1 — runtime shape gates so a hand-crafted
// `ipcRenderer.invoke('providers:*', ...)` payload can't reach the
// store layer with the wrong primitive types. Mirrors the
// `chat.ipc.ts` discipline (audit fix M-03).
import { PROVIDER_DIALECTS } from '@shared/types/provider.js';
import {
  assertString,
  assertObject,
  assertBoolean,
  assertEnum,
  assertOptionalString
} from './validate.js';

const log = logger.child('ipc/providers');

export function registerProvidersIpc(): void {
  wrapIpcHandler(IPC.PROVIDERS_LIST, async () => listProviders());

  wrapIpcHandler(IPC.PROVIDERS_ADD, async (_event, input: AddProviderInput) => {
    assertObject('providers:add', 'input', input);
    // `name` / `baseUrl` / `apiKey` are the renderer-side required
    // fields per `AddProviderInput`. Cap base URLs at the OS PATH_MAX
    // ballpark (2 KB is plenty for any real provider endpoint) and
    // hold api keys to 4 KB — long enough for any token format we
    // know (OpenRouter's are < 200 chars; Anthropic's < 100; even
    // multi-segment OAuth tokens stay well under 4 KB).
    //
    // Bug fix 2026-05-19: prior to this slot the assertion looked
    // for `input.label`, which is a field that does NOT exist on
    // `AddProviderInput` (the field is `name`). The renderer always
    // sent `name`, so the validator threw on every Add Provider
    // submission with a misleading "input.label must be a string"
    // 400. The audit-fix author perpetuated a typo from a sister
    // payload (workspaces:rename uses `label`); the only correct
    // field here is `name`.
    assertString('providers:add', 'input.name', (input as { name?: unknown }).name, { maxBytes: 256 });
    assertString('providers:add', 'input.baseUrl', (input as { baseUrl?: unknown }).baseUrl, { maxBytes: 2048 });
    assertString('providers:add', 'input.apiKey', (input as { apiKey?: unknown }).apiKey, {
      nonEmpty: false,
      maxBytes: 4096
    });
    if ('dialect' in input && input.dialect !== undefined) {
      assertEnum('providers:add', 'input.dialect', input.dialect, PROVIDER_DIALECTS);
    }
    if ('notes' in input && input.notes !== undefined) {
      assertString('providers:add', 'input.notes', input.notes, { maxBytes: 4096 });
    }
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
        modelThinking?: Record<string, ThinkingEffort | null>;
      }
    ) => {
      assertString('providers:update', 'id', id);
      assertObject('providers:update', 'patch', patch);
      if ('name' in patch && patch.name !== undefined) {
        assertString('providers:update', 'patch.name', patch.name, { maxBytes: 256 });
      }
      if ('baseUrl' in patch && patch.baseUrl !== undefined) {
        assertString('providers:update', 'patch.baseUrl', patch.baseUrl, { maxBytes: 2048 });
      }
      if ('apiKey' in patch && patch.apiKey !== undefined) {
        assertString('providers:update', 'patch.apiKey', patch.apiKey, {
          nonEmpty: false,
          maxBytes: 4096
        });
      }
      if ('dialect' in patch && patch.dialect !== undefined) {
        assertEnum('providers:update', 'patch.dialect', patch.dialect, PROVIDER_DIALECTS);
      }
      if ('enabled' in patch && patch.enabled !== undefined) {
        assertBoolean('providers:update', 'patch.enabled', patch.enabled);
      }
      if ('modelThinking' in patch && patch.modelThinking !== undefined) {
        assertObject('providers:update', 'patch.modelThinking', patch.modelThinking);
        for (const [modelId, effort] of Object.entries(patch.modelThinking)) {
          if (effort === null) continue;
          const normalized = normalizePersistedThinkingEffort(effort);
          if (normalized === undefined) {
            assertEnum(
              'providers:update',
              `patch.modelThinking.${modelId}`,
              effort,
              [...THINKING_EFFORTS, LEGACY_THINKING_EFFORT_MAX]
            );
          }
          (patch.modelThinking as Record<string, ThinkingEffort | null>)[modelId] = normalized!;
        }
      }
      if ('attribution' in patch && patch.attribution !== undefined) {
        assertObject('providers:update', 'patch.attribution', patch.attribution);
        const attr = patch.attribution as Record<string, unknown>;
        if ('httpReferer' in attr && attr.httpReferer !== undefined) {
          assertOptionalString('providers:update', 'patch.attribution.httpReferer', attr.httpReferer, {
            maxBytes: 2048
          });
        }
        if ('xTitle' in attr && attr.xTitle !== undefined) {
          assertOptionalString('providers:update', 'patch.attribution.xTitle', attr.xTitle, {
            maxBytes: 256
          });
        }
      }
      return updateProvider(id, patch);
    }
  );

  wrapIpcHandler(IPC.PROVIDERS_REMOVE, async (_event, id: string) => {
    assertString('providers:remove', 'id', id);
    return removeProvider(id);
  });

  // Discovery — `force` defaults true (the renderer button is "Refresh"), but
  // callers can pass false to honor the in-process TTL cache.
  wrapIpcHandler(
    IPC.PROVIDERS_DISCOVER_MODELS,
    async (_event, id: string, force?: boolean) => {
      assertString('providers:discoverModels', 'id', id);
      if (force !== undefined) {
        assertBoolean('providers:discoverModels', 'force', force);
      }
      return discoverModels(id, force ?? true);
    }
  );

  wrapIpcHandler(IPC.PROVIDERS_TEST, async (_event, id: string) => {
    assertString('providers:test', 'id', id);
    return testProvider(id);
  });

}
