/**
 * ComposerStatusStrip — ask-user reply hint and low-balance warnings.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ComposerStatusStrip } from '@renderer/components/composer/ComposerStatusStrip';
import { useChatStore } from '@renderer/store/useChatStore';
import { useProviderStore } from '@renderer/store/useProviderStore';
import { INITIAL_TIMELINE_STATE } from '@renderer/components/timeline/reducer/types';

const OPENAI_PROVIDER_ID = 'prov-openai';

beforeEach(() => {
  useChatStore.setState({
    ...INITIAL_TIMELINE_STATE,
    isProcessing: false,
    orchestratorUsage: undefined,
    events: []
  });
  useProviderStore.setState({
    providers: [
      {
        id: OPENAI_PROVIDER_ID,
        name: 'OpenAI',
        baseUrl: 'https://api.openai.com/v1',
        dialect: 'openai',
        enabled: true,
        models: []
      },
      {
        id: 'prov-ollama',
        name: 'Ollama Cloud',
        baseUrl: 'https://ollama.com',
        dialect: 'ollama-native',
        enabled: true,
        models: []
      }
    ]
  } as never);
});

describe('ComposerStatusStrip', () => {
  it('renders nothing when idle with no ask-user, cache hint, or account line', () => {
    useChatStore.setState({
      events: [{ kind: 'user-prompt', id: 'p1', ts: 1, content: 'Hi' }]
    });

    const { container } = render(<ComposerStatusStrip />);
    expect(container.querySelector('.vx-composer-status-strip')).toBeNull();
  });

  it('shows ask-user hint when pending', () => {
    render(
      <ComposerStatusStrip
        pendingAskUser={{
          kind: 'ask-user-prompt',
          id: 'q1',
          ts: 1,
          status: 'pending',
          payload: { title: 'Choose one', questions: [] }
        }}
      />
    );

    expect(screen.getByText(/Reply needed/i)).toBeInTheDocument();
    expect(screen.getByText(/"Choose one"/i)).toBeInTheDocument();
  });

  it('shows mid-run Send/Queue guidance when processingRun is set', () => {
    render(<ComposerStatusStrip processingRun />);
    const hint = screen.getByRole('status', { name: /Send steers mid-run/i });
    expect(hint).toHaveAttribute('title', 'Send steers mid-run · Queue before finish');
    expect(hint).toHaveTextContent('Send steers mid-run · Queue before finish');
  });

  it('does not show run phase labels', () => {
    useChatStore.setState({
      isProcessing: true,
      runStartedAt: Date.now() - 5000,
      latestOrchestratorRunStatus: {
        kind: 'run-status',
        id: 'rs1',
        ts: Date.now(),
        phase: 'running-tool',
        label: 'Running tool',
        detail: { toolName: 'read' }
      }
    } as never);

    const { container } = render(<ComposerStatusStrip />);
    expect(container.querySelector('.vx-composer-status-strip')).toBeNull();
    expect(screen.queryByText(/Exploring/i)).toBeNull();
  });
});
