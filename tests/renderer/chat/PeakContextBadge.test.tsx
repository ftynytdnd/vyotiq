import { describe, expect, it, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PeakContextBadge } from '@renderer/components/chat/PeakContextBadge.js';
import { useChatStore } from '@renderer/store/useChatStore.js';
import { useProviderStore } from '@renderer/store/useProviderStore.js';
import { INITIAL_TIMELINE_STATE } from '@renderer/components/timeline/reducer/types';
import type { ConversationMeta } from '@shared/types/chat.js';

const CONV_ID = 'conv-peak-1';

const baseMeta: ConversationMeta = {
  id: CONV_ID,
  title: 'Peak test',
  createdAt: 0,
  updatedAt: 0,
  eventCount: 1,
  workspaceId: 'ws-1',
  lastProviderId: 'openai',
  lastModelId: 'gpt-4o'
};

beforeEach(() => {
  useProviderStore.setState({
    providers: [
      {
        id: 'openai',
        name: 'OpenAI',
        enabled: true,
        dialect: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        models: [{ id: 'gpt-4o', contextWindow: 128_000 }]
      }
    ],
    loading: false,
    error: null
  });
  useChatStore.setState({
    ...INITIAL_TIMELINE_STATE,
    slices: {},
    runIdToConv: {},
    runIdToModel: {}
  });
});

describe('PeakContextBadge', () => {
  it('renders from persisted meta when the slice is not hydrated', () => {
    render(
      <PeakContextBadge
        meta={{ ...baseMeta, peakPromptTokens: 96_000 }}
      />
    );
    expect(screen.getByText('75%')).toBeTruthy();
  });

  it('prefers the higher hydrated slice peak over meta', () => {
    useChatStore.setState({
      slices: {
        [CONV_ID]: {
          ...INITIAL_TIMELINE_STATE,
          conversationId: CONV_ID,
          orchestratorUsage: {
            latest: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
            peak: { promptTokens: 110_000, completionTokens: 0, totalTokens: 110_000 },
            cumulative: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
            samples: 1
          }
        }
      }
    });
    render(
      <PeakContextBadge
        meta={{ ...baseMeta, peakPromptTokens: 96_000 }}
      />
    );
    expect(screen.getByText('86%')).toBeTruthy();
  });

  it('stays hidden below the 5% threshold', () => {
    render(
      <PeakContextBadge
        meta={{ ...baseMeta, peakPromptTokens: 4_000 }}
      />
    );
    expect(screen.queryByText(/\d+%/)).toBeNull();
  });
});
