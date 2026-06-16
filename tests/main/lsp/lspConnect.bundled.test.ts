/**
 * lspConnect — built-in language servers start without user configuration.
 */

import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const workspaceId = 'ws-lsp-bundle-test';

vi.mock('../../../src/main/workspace/workspaceState.js', () => ({
  listWorkspaces: vi.fn()
}));

vi.mock('../../../src/main/settings/settingsStore.js', () => ({
  getSettings: vi.fn()
}));

vi.mock('../../../src/main/lsp/lspWorkspaceConfig.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/main/lsp/lspWorkspaceConfig.js')>();
  return {
    ...actual,
    readWorkspaceLspOverride: vi.fn(async () => null)
  };
});

describe('lspConnect bundled', () => {
  let workspacePath = '';

  beforeAll(async () => {
    workspacePath = join(tmpdir(), `vyotiq-lsp-${Date.now()}`);
    await mkdir(workspacePath, { recursive: true });
  });

  beforeEach(async () => {
    const { listWorkspaces } = await import('../../../src/main/workspace/workspaceState.js');
    const { getSettings } = await import('../../../src/main/settings/settingsStore.js');
    vi.mocked(listWorkspaces).mockResolvedValue({
      workspaces: [{ id: workspaceId, path: workspacePath, label: 'test', addedAt: 0 }],
      activeId: workspaceId
    });
    vi.mocked(getSettings).mockResolvedValue({
      ui: { editorLsp: { enabled: true } }
    });
  });

  afterEach(async () => {
    const { lspDisconnect } = await import('../../../src/main/lsp/lspManager.js');
    await lspDisconnect(workspaceId);
  });

  it('starts built-in pyright without a configured command', async () => {
    const { lspConnect } = await import('../../../src/main/lsp/lspManager.js');
    const result = await lspConnect({ workspaceId, languageId: 'python' });
    expect(result.ok).toBe(true);
    expect(result.configSource).toBe('bundled');
    expect(result.status.connected).toBe(true);
    expect(result.status.pid).toBeGreaterThan(0);
  }, 20_000);

  it('starts built-in typescript-language-server for javascript', async () => {
    const { lspConnect } = await import('../../../src/main/lsp/lspManager.js');
    const result = await lspConnect({ workspaceId, languageId: 'javascript' });
    expect(result.ok).toBe(true);
    expect(result.configSource).toBe('bundled');
    expect(result.status.connected).toBe(true);
  }, 20_000);
});
