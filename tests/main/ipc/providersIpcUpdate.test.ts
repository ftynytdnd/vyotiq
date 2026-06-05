import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ipcMain } from 'electron';
import { IPC } from '@shared/constants';
import type { ProviderConfig } from '@shared/types/provider';

interface MockIpcMain {
  __invoke: (channel: string, ...args: unknown[]) => unknown;
  __handlers: Map<string, unknown>;
}

const mockIpc = ipcMain as unknown as MockIpcMain;

const updateProviderMock = vi.fn();

vi.mock('@main/providers/providerStore', () => ({
  addProvider: vi.fn(),
  listProviders: vi.fn(async () => []),
  removeProvider: vi.fn(async () => undefined),
  updateProvider: (...args: unknown[]) => updateProviderMock(...args)
}));

vi.mock('@main/providers/modelDiscovery', () => ({
  detectDialect: vi.fn(),
  discoverModels: vi.fn(async () => []),
  testProvider: vi.fn(async () => ({ ok: true }))
}));

const { registerProvidersIpc } = await import('@main/ipc/providers.ipc');

describe('registerProvidersIpc — PROVIDERS_UPDATE', () => {
  beforeEach(() => {
    updateProviderMock.mockReset();
    updateProviderMock.mockResolvedValue({
      id: 'p1',
      name: 'Test',
      baseUrl: 'https://api.openai.com',
      enabled: true
    } satisfies ProviderConfig);
    mockIpc.__handlers.clear();
    registerProvidersIpc();
  });

  it('validates modelThinking effort values', async () => {
    await mockIpc.__invoke(IPC.PROVIDERS_UPDATE, 'p1', {
      modelThinking: { 'gpt-5': 'high' }
    });
    expect(updateProviderMock).toHaveBeenCalledWith('p1', {
      modelThinking: { 'gpt-5': 'high' }
    });
  });

  it('rejects invalid modelThinking effort', async () => {
    await expect(
      mockIpc.__invoke(IPC.PROVIDERS_UPDATE, 'p1', {
        modelThinking: { 'gpt-5': 'ultra' }
      })
    ).rejects.toThrow();
    expect(updateProviderMock).not.toHaveBeenCalled();
  });

  it('normalizes legacy max to xhigh in modelThinking', async () => {
    await mockIpc.__invoke(IPC.PROVIDERS_UPDATE, 'p1', {
      modelThinking: { 'gpt-5': 'max' }
    });
    expect(updateProviderMock).toHaveBeenCalledWith('p1', {
      modelThinking: { 'gpt-5': 'xhigh' }
    });
  });

  it('validates contextOverrides as positive integers', async () => {
    await mockIpc.__invoke(IPC.PROVIDERS_UPDATE, 'p1', {
      contextOverrides: { 'gpt-5': 200000 }
    });
    expect(updateProviderMock).toHaveBeenCalledWith('p1', {
      contextOverrides: { 'gpt-5': 200000 }
    });
  });

  it('rejects invalid contextOverrides', async () => {
    await expect(
      mockIpc.__invoke(IPC.PROVIDERS_UPDATE, 'p1', {
        contextOverrides: { 'gpt-5': -1 }
      })
    ).rejects.toThrow(/positive integer/);
  });
});
