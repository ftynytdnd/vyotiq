import { describe, expect, it } from 'vitest';
import {
  isComposerModelValid,
  resolveComposerModel
} from '@renderer/lib/resolveComposerModel';
import type { ProviderConfig } from '@shared/types/provider.js';

const providers: ProviderConfig[] = [
  {
    id: 'remote',
    name: 'Remote',
    baseUrl: 'https://api.example.com',
    dialect: 'openai',
    enabled: true,
    models: [
      { id: 'alpha', contextWindow: 128_000 },
      { id: 'beta', contextWindow: 128_000 }
    ],
    modelThinking: { beta: 'high' }
  }
];

describe('resolveComposerModel', () => {
  it('prefers workspace last model over default and first catalog model', () => {
    const sel = resolveComposerModel({
      providers,
      activeConversationId: 'c1',
      conversationList: [{ id: 'c1', workspaceId: 'ws-1' } as never],
      activeWorkspaceId: 'ws-1',
      lastModelByWorkspace: { 'ws-1': { providerId: 'remote', modelId: 'beta' } },
      defaultModel: { providerId: 'remote', modelId: 'alpha' }
    });

    expect(sel).toEqual({
      providerId: 'remote',
      modelId: 'beta',
      thinkingEffort: 'high'
    });
  });

  it('prefers conversation last model over workspace map', () => {
    const sel = resolveComposerModel({
      providers,
      activeConversationId: 'c1',
      conversationList: [
        {
          id: 'c1',
          workspaceId: 'ws-1',
          lastProviderId: 'remote',
          lastModelId: 'alpha'
        } as never
      ],
      activeWorkspaceId: 'ws-1',
      lastModelByWorkspace: { 'ws-1': { providerId: 'remote', modelId: 'beta' } },
      defaultModel: { providerId: 'remote', modelId: 'beta' }
    });

    expect(sel).toEqual({ providerId: 'remote', modelId: 'alpha' });
  });

  it('ignores invalid stored selections', () => {
    expect(
      isComposerModelValid({ providerId: 'remote', modelId: 'missing' }, providers)
    ).toBe(false);

    const sel = resolveComposerModel({
      providers,
      activeConversationId: null,
      conversationList: [],
      activeWorkspaceId: 'ws-1',
      lastModelByWorkspace: { 'ws-1': { providerId: 'remote', modelId: 'missing' } },
      defaultModel: { providerId: 'remote', modelId: 'alpha' }
    });

    expect(sel).toEqual({ providerId: 'remote', modelId: 'alpha' });
  });
});
