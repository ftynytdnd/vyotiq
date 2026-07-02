import { describe, expect, it } from 'vitest';
import { resolveGitCommitMessageModel } from '@shared/git/resolveGitCommitMessageModel';
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
    ]
  }
];

describe('resolveGitCommitMessageModel', () => {
  it('prefers workspace last model over default', () => {
    expect(
      resolveGitCommitMessageModel(
        {
          providers,
          defaultModel: { providerId: 'remote', modelId: 'alpha' },
          lastModelByWorkspace: { 'ws-1': { providerId: 'remote', modelId: 'beta' } }
        },
        'ws-1'
      )
    ).toEqual({ providerId: 'remote', modelId: 'beta' });
  });

  it('uses authoring then default when auto mode is on for workspace', () => {
    expect(
      resolveGitCommitMessageModel(
        {
          providers,
          authoringModel: { providerId: 'remote', modelId: 'beta' },
          defaultModel: { providerId: 'remote', modelId: 'alpha' },
          autoModelByWorkspace: { 'ws-1': true },
          lastModelByWorkspace: { 'ws-1': { providerId: 'remote', modelId: 'alpha' } }
        },
        'ws-1'
      )
    ).toEqual({ providerId: 'remote', modelId: 'beta' });
  });

  it('falls back to first enabled catalog model', () => {
    expect(resolveGitCommitMessageModel({ providers }, 'ws-1')).toEqual({
      providerId: 'remote',
      modelId: 'alpha'
    });
  });
});
