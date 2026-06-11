import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ChatLandingSetup } from '@renderer/pages/ChatLandingSetup';

describe('ChatLandingSetup', () => {
  it('shows workspace CTA when no workspace is open', () => {
    const onPickWorkspace = vi.fn();
    render(
      <ChatLandingSetup
        hasWorkspace={false}
        hasProviders={false}
        onPickWorkspace={onPickWorkspace}
        onOpenProviders={() => undefined}
      />
    );

    expect(screen.getByText('Open a workspace to begin')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Open workspace/i })).toBeTruthy();
  });

  it('shows provider CTA when workspace is open but no providers', () => {
    render(
      <ChatLandingSetup
        hasWorkspace
        hasProviders={false}
        onPickWorkspace={() => undefined}
        onOpenProviders={() => undefined}
      />
    );

    expect(screen.getByText('Configure an AI provider')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Configure provider/i })).toBeTruthy();
  });

  it('renders nothing when workspace and providers are ready', () => {
    const { container } = render(
      <ChatLandingSetup
        hasWorkspace
        hasProviders
        onPickWorkspace={() => undefined}
        onOpenProviders={() => undefined}
      />
    );

    expect(container.firstChild).toBeNull();
  });
});
