/**
 * PromptCachingPanel — settings toggles and session summary.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PromptCachingPanel } from '@renderer/components/settings/PromptCachingPanel';
import { useSettingsStore } from '@renderer/store/useSettingsStore';
import { useChatStore } from '@renderer/store/useChatStore';
import { INITIAL_TIMELINE_STATE } from '@renderer/components/timeline/reducer/types';

vi.mock('@renderer/lib/ipc.js', () => ({
  vyotiq: {
    settings: {
      set: vi.fn(async () => ({}))
    },
    promptCache: {
      getStatus: vi.fn(async () => ({ geminiExplicitCache: { state: 'disabled' as const } }))
    }
  }
}));

beforeEach(() => {
  useSettingsStore.setState({
    settings: { ui: { promptCaching: { anthropicCacheDiagnostics: false, geminiExplicitCache: false } } },
    refresh: vi.fn()
  } as never);
  useChatStore.setState({
    ...INITIAL_TIMELINE_STATE,
    orchestratorUsage: undefined,
    lastPromptCacheMissReason: undefined
  } as never);
});

describe('PromptCachingPanel', () => {
  it('renders prompt caching toggles', () => {
    render(<PromptCachingPanel />);
    expect(screen.getByText('Anthropic cache diagnostics')).toBeInTheDocument();
    expect(screen.getByText('Gemini explicit cache')).toBeInTheDocument();
  });

  it('shows last-turn cache stats when usage is present', () => {
    useChatStore.setState({
      orchestratorUsage: {
        latest: { promptTokens: 10_000, completionTokens: 200, totalTokens: 10_200, cachedPromptTokens: 8_000 },
        peak: { promptTokens: 10_000, completionTokens: 200, totalTokens: 10_200, cachedPromptTokens: 8_000 },
        cumulative: { promptTokens: 10_000, completionTokens: 200, totalTokens: 10_200, cachedPromptTokens: 8_000 },
        samples: 1
      },
      lastPromptCacheMissReason: 'tools_changed'
    } as never);

    render(<PromptCachingPanel />);
    expect(screen.getByText('Cache read')).toBeInTheDocument();
    expect(screen.getByText('tools_changed')).toBeInTheDocument();
  });

  it('saves anthropic diagnostics toggle via settings IPC', async () => {
    const user = userEvent.setup();
    const { vyotiq } = await import('@renderer/lib/ipc.js');
    render(<PromptCachingPanel />);

    await user.click(screen.getByRole('switch', { name: 'Anthropic cache diagnostics' }));

    expect(vyotiq.settings.set).toHaveBeenCalledWith({
      ui: { promptCaching: { anthropicCacheDiagnostics: true, geminiExplicitCache: false } }
    });
  });
});
