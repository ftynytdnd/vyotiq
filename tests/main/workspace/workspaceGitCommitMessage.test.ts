import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../../../src/main/providers/chatClient.js', () => ({
  streamChat: vi.fn()
}));
vi.mock('../../../src/main/settings/settingsStore.js', () => ({
  getSettings: vi.fn()
}));
vi.mock('../../../src/main/providers/providerStore.js', () => ({
  listProviders: vi.fn()
}));

import { streamChat } from '../../../src/main/providers/chatClient.js';
import { getSettings } from '../../../src/main/settings/settingsStore.js';
import { listProviders } from '../../../src/main/providers/providerStore.js';
import { generateGitCommitMessage } from '../../../src/main/workspace/workspaceGitCommitMessage.js';

async function* oneShot(content: string) {
  yield { contentDelta: content, finishReason: 'stop' as const };
}

describe('generateGitCommitMessage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getSettings).mockResolvedValue({
      authoringModel: null,
      defaultModel: { providerId: 'p1', modelId: 'm1' },
      ui: {}
    } as never);
    vi.mocked(listProviders).mockResolvedValue([
      { id: 'p1', name: 'Test', enabled: true, models: [{ id: 'm1' }] }
    ] as never);
  });

  it('rejects when model returns non-conventional message after retry', async () => {
    vi.mocked(streamChat).mockImplementation(async function* () {
      yield { contentDelta: 'updated some files', finishReason: 'stop' as const };
    });

    const gitRun = vi.fn(async (args: string[]) => {
      if (args[0] === 'status') return 'A  src/a.ts';
      if (args[0] === 'log') return '';
      if (args[0] === 'diff') return '';
      return '';
    });

    await expect(generateGitCommitMessage(gitRun, 'ws-1', '/tmp/ws')).rejects.toThrow(
      /valid Conventional Commits subject|too shallow/
    );
    expect(streamChat).toHaveBeenCalledTimes(2);
  });

  it('returns sanitized conventional message with prose body', async () => {
    vi.mocked(streamChat).mockImplementation(() =>
      oneShot(
        'feat(app): add user dashboard\n\nThis adds a signed-in dashboard with summary cards on the home route. Dashboard.tsx renders the layout and App.tsx wires the new route into navigation.'
      )
    );

    const gitRun = vi.fn(async (args: string[]) => {
      if (args[0] === 'status') return 'A  src/Dashboard.tsx\nA  src/App.tsx\nA  src/routes.tsx\nA  src/layout.tsx';
      if (args[0] === 'log') return 'feat(app): prior work\n\nEarlier change.\n---';
      if (args[0] === 'diff' && args[1] === '--cached' && args[2] === '--stat') return '4 files changed';
      if (args[0] === 'diff' && args[1] === '--cached') {
        return 'diff --git a/src/App.tsx b/src/App.tsx\n+export function App() {}';
      }
      if (args[0] === 'diff') return '';
      return '';
    });

    const result = await generateGitCommitMessage(gitRun, 'ws-1', '/tmp/ws');
    expect(result.message).toMatch(/^feat\(app\): add user dashboard/);
    expect(result.message).toContain('signed-in dashboard');
    expect(Array.isArray(result.warnings)).toBe(true);
  });

  it('returns deterministic message for lockfile-only stages without calling model', async () => {
    const gitRun = vi.fn(async (args: string[]) => {
      if (args[0] === 'status') return 'A  pnpm-lock.yaml';
      if (args[0] === 'log') return '';
      if (args[0] === 'diff' && args[1] === '--cached' && args[2] === '--stat') return '1 file changed';
      if (args[0] === 'diff' && args[1] === '--cached') return 'diff --git a/pnpm-lock.yaml';
      if (args[0] === 'diff') return '';
      return '';
    });

    const result = await generateGitCommitMessage(gitRun, 'ws-1', '/tmp/ws');
    expect(result.message).toMatch(/^chore: update lockfile/);
    expect(streamChat).not.toHaveBeenCalled();
  });
});
