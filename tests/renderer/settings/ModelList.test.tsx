/**
 * `ModelList` Phase-2 Discover CTA + filter behavior.
 */

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ModelList } from '@renderer/components/settings/ModelList';
import type { ModelInfo } from '@shared/types/provider';

const sampleModels: ModelInfo[] = [
  { id: 'gpt-4', contextWindow: 128_000 } as ModelInfo,
  { id: 'gpt-3.5', contextWindow: 16_000 } as ModelInfo,
  { id: 'claude-3-opus', contextWindow: 200_000 } as ModelInfo
];

describe('ModelList', () => {
  it('renders the loading state when loading=true', () => {
    render(<ModelList models={[]} loading />);
    expect(screen.getByText(/Discovering models/)).toBeInTheDocument();
  });

  it('renders the empty state with a custom message', () => {
    render(<ModelList models={[]} emptyMessage="Nothing here yet." />);
    expect(screen.getByText('Nothing here yet.')).toBeInTheDocument();
  });

  it('shows a Discover-models CTA when onDiscover is provided', async () => {
    const onDiscover = vi.fn();
    render(<ModelList models={[]} onDiscover={onDiscover} />);
    const btn = screen.getByRole('button', { name: /Discover models/ });
    expect(btn).toBeInTheDocument();
    await userEvent.click(btn);
    expect(onDiscover).toHaveBeenCalledOnce();
  });

  it('disables the CTA when discoverDisabled=true', () => {
    render(<ModelList models={[]} onDiscover={() => {}} discoverDisabled />);
    expect(screen.getByRole('button', { name: /Discover models/ })).toBeDisabled();
  });

  it('renders every model when no filter is applied', () => {
    render(<ModelList models={sampleModels} />);
    for (const m of sampleModels) {
      expect(screen.getByText(m.id)).toBeInTheDocument();
    }
  });

  it('filters models by substring (case-insensitive)', async () => {
    render(<ModelList models={sampleModels} />);
    const filter = screen.getByPlaceholderText(/Filter \d+ models…/);
    await userEvent.type(filter, 'GPT');
    expect(screen.getByText('gpt-4')).toBeInTheDocument();
    expect(screen.getByText('gpt-3.5')).toBeInTheDocument();
    expect(screen.queryByText('claude-3-opus')).toBeNull();
  });

  it('shows an inline configure hint instead of a detached options column', () => {
    render(
      <ModelList
        models={sampleModels}
        onContextOverrideSave={() => {}}
      />
    );
    expect(screen.getByText(/Click a model row or its context badge to configure/i)).toBeInTheDocument();
    expect(screen.queryByText('Options')).toBeNull();
  });
});
