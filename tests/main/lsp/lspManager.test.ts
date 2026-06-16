/**
 * LSP manager must not throw when polled for a removed workspace id.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/main/workspace/workspaceState.js', () => ({
  listWorkspaces: vi.fn(async () => ({ workspaces: [], activeId: null }))
}));

vi.mock('../../../src/main/settings/settingsStore.js', () => ({
  getSettings: vi.fn(async () => ({
    ui: { editorLsp: { enabled: true, command: 'typescript-language-server', args: ['--stdio'] } }
  }))
}));

vi.mock('../../../src/main/lsp/lspWorkspaceConfig.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/main/lsp/lspWorkspaceConfig.js')>();
  return {
    ...actual,
    readWorkspaceLspOverride: vi.fn(async () => null)
  };
});

describe('lspGetStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns a disabled result for an unknown workspace id', async () => {
    const { lspGetStatus } = await import('../../../src/main/lsp/lspManager.js');
    const result = await lspGetStatus({ workspaceId: 'missing-workspace-id' });
    expect(result.ok).toBe(false);
    expect(result.configSource).toBe('disabled');
    expect(result.reason).toBe('Workspace not found');
    expect(result.status.connected).toBe(false);
  });
});
