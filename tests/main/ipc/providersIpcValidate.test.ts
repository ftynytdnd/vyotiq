/**
 * Regression tests for `providers:add` payload validation.
 *
 * Bug 2026-05-19: the IPC handler's shape gate asserted `input.label`
 * — a field that does NOT exist on `AddProviderInput`. The renderer
 * always sent `name`, so every Add Provider submission threw
 * "providers:add: input.label must be a string" before reaching the
 * store. This suite locks in the correct field-name contract so a
 * future audit-fix can't quietly regress the validator to look for a
 * sister payload's field name (`workspaces:rename` uses `label`, which
 * is what originally seeded the typo).
 *
 * Mocks: the providerStore + modelDiscovery layers are stubbed so the
 * test focuses on the validator. Auto-detect is forced to throw so
 * the handler takes the warn-and-default branch — discoverModels is
 * also stubbed to return `[]`, leaving `addProvider` as the only
 * payload-shape consumer.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ipcMain } from 'electron';
import { IPC } from '@shared/constants';
import type { AddProviderInput, ProviderConfig } from '@shared/types/provider';

interface MockIpcMain {
  __invoke: (channel: string, ...args: unknown[]) => unknown;
  __handlers: Map<string, unknown>;
}

const mockIpc = ipcMain as unknown as MockIpcMain;

// The handler under test pulls these in transitively; stub the store
// + discovery so disk + network are out of the picture. We capture
// the input passed to `addProvider` so the happy-path assertion can
// verify the validator forwarded the shape unchanged.
const addProviderMock = vi.fn<(input: AddProviderInput) => Promise<ProviderConfig>>();

vi.mock('@main/providers/providerStore', () => ({
  addProvider: (input: AddProviderInput) => addProviderMock(input),
  listProviders: vi.fn(async () => []),
  removeProvider: vi.fn(async () => undefined),
  updateProvider: vi.fn(async () => undefined)
}));

vi.mock('@main/providers/modelDiscovery', () => ({
  // Force the auto-detect branch to throw so the handler takes the
  // "default to openai" fallback (covered by an existing test for
  // modelDiscovery itself). Discovery returns an empty model list
  // so the post-add discovery path does not blow up.
  detectDialect: vi.fn(async () => {
    throw new Error('test: detect disabled');
  }),
  discoverModels: vi.fn(async () => []),
  testProvider: vi.fn(async () => ({ ok: true }))
}));

const { registerProvidersIpc } = await import('@main/ipc/providers.ipc');

describe('registerProvidersIpc — PROVIDERS_ADD payload validation', () => {
  beforeEach(() => {
    addProviderMock.mockReset();
    addProviderMock.mockImplementation(async (input) => ({
      id: 'p-test',
      name: input.name,
      baseUrl: input.baseUrl,
      enabled: true,
      models: [],
      lastDiscoveredAt: 0
    }));
    mockIpc.__handlers.clear();
    registerProvidersIpc();
  });

  it('accepts a payload whose required string fields use the canonical AddProviderInput keys (`name`, `baseUrl`, `apiKey`)', async () => {
    // Renderer-shaped payload — exactly what `AddProviderForm.tsx`
    // sends today. If the validator regresses to look for `label`
    // again this call will throw with the bug-era message.
    const payload: AddProviderInput = {
      name: 'My Provider',
      baseUrl: 'https://example.test/v1',
      apiKey: 'sk-test-value'
    };

    const created = await mockIpc.__invoke(IPC.PROVIDERS_ADD, payload);

    // The validator must have forwarded the SAME payload (modulo the
    // failed-and-defaulted dialect) to the store. We assert the
    // store saw the `name` field intact — that's the contract the
    // bug-fix preserves.
    expect(addProviderMock).toHaveBeenCalledTimes(1);
    const forwarded = addProviderMock.mock.calls[0]![0];
    expect(forwarded.name).toBe('My Provider');
    expect(forwarded.baseUrl).toBe('https://example.test/v1');
    expect(forwarded.apiKey).toBe('sk-test-value');

    // The handler returns the persisted record — sanity-check the
    // shape so an accidental future return-type regression also gets
    // caught here.
    expect((created as ProviderConfig).name).toBe('My Provider');
  });

  it('rejects a payload missing `name` with a friendly "input.name must be a string" message (NOT the pre-fix "input.label …")', async () => {
    // Hand-crafted invalid payload — the same way the renderer would
    // present it if a typo lost the `name` field. The error message
    // must call out the correct field so future triage doesn't chase
    // a non-existent `label` slot.
    const bad = {
      baseUrl: 'https://example.test/v1',
      apiKey: 'sk-test-value'
    } as unknown as AddProviderInput;

    await expect(mockIpc.__invoke(IPC.PROVIDERS_ADD, bad)).rejects.toThrow(
      /providers:add: input\.name must be a string/
    );
    // And — critically — the regression: the error must NOT mention
    // `input.label`. This is the literal string the bug surfaced.
    await expect(mockIpc.__invoke(IPC.PROVIDERS_ADD, bad)).rejects.not.toThrow(
      /input\.label/
    );

    // The store must not have been touched on a rejected payload.
    expect(addProviderMock).not.toHaveBeenCalled();
  });

  it('rejects a payload missing `baseUrl` before reaching the store', async () => {
    const bad = {
      name: 'My Provider',
      apiKey: 'sk-test-value'
    } as unknown as AddProviderInput;

    await expect(mockIpc.__invoke(IPC.PROVIDERS_ADD, bad)).rejects.toThrow(
      /providers:add: input\.baseUrl must be a string/
    );
    expect(addProviderMock).not.toHaveBeenCalled();
  });

  it('rejects a payload missing `apiKey` before reaching the store', async () => {
    const bad = {
      name: 'My Provider',
      baseUrl: 'https://example.test/v1'
    } as unknown as AddProviderInput;

    await expect(mockIpc.__invoke(IPC.PROVIDERS_ADD, bad)).rejects.toThrow(
      /providers:add: input\.apiKey must be a string/
    );
    expect(addProviderMock).not.toHaveBeenCalled();
  });

  it('accepts an empty-string apiKey (local providers do not always require one)', async () => {
    // The validator passes `{ nonEmpty: false }` for apiKey — local
    // Ollama / vLLM / LM Studio commonly have no auth. This guard
    // locks the behaviour in so a future "harden the validator"
    // pass cannot accidentally re-tighten it.
    const payload: AddProviderInput = {
      name: 'Local Ollama',
      baseUrl: 'http://127.0.0.1:11434',
      apiKey: ''
    };

    await mockIpc.__invoke(IPC.PROVIDERS_ADD, payload);
    expect(addProviderMock).toHaveBeenCalledTimes(1);
    expect(addProviderMock.mock.calls[0]![0].apiKey).toBe('');
  });
});
