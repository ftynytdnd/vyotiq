import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ChatLandingSetup } from '@renderer/pages/ChatLandingSetup';

vi.mock('@renderer/lib/ipc.js', () => ({
  vyotiq: {
    workspace: {
      gitStatus: vi.fn(async () => ({
        paths: {},
        context: { isRepo: true, branch: 'main', headShort: 'abc', dirtyCount: 2 }
      }))
    }
  }
}));

describe('ChatLandingSetup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

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
    const workspaceBtn = screen.getByRole('button', { name: /Open workspace/i });
    expect(workspaceBtn).toBeTruthy();
    expect(workspaceBtn.className).toContain('vx-btn-accent-fill');
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
    const providerBtn = screen.getByRole('button', { name: /Configure provider/i });
    expect(providerBtn).toBeTruthy();
    expect(providerBtn.className).toContain('vx-btn-accent-fill');
  });

  it('renders nothing when ready but not on landing', () => {
    const { container } = render(
      <ChatLandingSetup
        hasWorkspace
        hasProviders
        landing={false}
        workspaceId="ws1"
        workspaceLabel="vyotiq"
        onPickWorkspace={() => undefined}
        onOpenProviders={() => undefined}
      />
    );

    expect(container.firstChild).toBeNull();
  });

  it('shows interactive git context when ready on landing', async () => {
    render(
      <ChatLandingSetup
        hasWorkspace
        hasProviders
        landing
        workspaceId="ws1"
        workspaceLabel="vyotiq"
        onPickWorkspace={() => undefined}
        onOpenProviders={() => undefined}
      />
    );

    expect(await screen.findByRole('navigation', { name: 'Workspace context' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Workspace vyotiq' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '2 uncommitted changes' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Branch main' })).toBeTruthy();
  });

  it('shows ahead and behind on landing git context', async () => {
    const { vyotiq } = await import('@renderer/lib/ipc.js');
    vi.mocked(vyotiq.workspace.gitStatus).mockResolvedValueOnce({
      paths: {},
      context: {
        isRepo: true,
        branch: 'main',
        headShort: 'abc',
        dirtyCount: 0,
        ahead: 2,
        behind: 1
      }
    });

    render(
      <ChatLandingSetup
        hasWorkspace
        hasProviders
        landing
        workspaceId="ws1"
        workspaceLabel="vyotiq"
        onPickWorkspace={() => undefined}
        onOpenProviders={() => undefined}
      />
    );

    expect(await screen.findByRole('button', { name: 'Branch main ↑2 ↓1' })).toBeTruthy();
  });
});
