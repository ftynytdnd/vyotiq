import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SkillsPanel } from '@renderer/components/settings/SkillsPanel';

vi.mock('@renderer/lib/ipc.js', () => ({
  vyotiq: {
    skills: {
      list: vi.fn(async () => [
        {
          name: 'deploy-app',
          description: 'Deploy staging',
          source: 'workspace',
          rootPath: 'C:/proj/.vyotiq/skills/deploy-app',
          skillMdPath: 'C:/proj/.vyotiq/skills/deploy-app/SKILL.md'
        },
        {
          name: 'create-skill',
          description: 'Create skills',
          source: 'bundled',
          rootPath: 'bundled://create-skill',
          skillMdPath: 'bundled://create-skill/SKILL.md',
          disableModelInvocation: true
        }
      ]),
      create: vi.fn(),
      reveal: vi.fn()
    }
  }
}));

vi.mock('@renderer/store/useWorkspaceStore.js', () => ({
  useWorkspaceStore: (sel: (s: { activeId: string; info: { path: string }; list: [] }) => unknown) =>
    sel({ activeId: 'ws-1', info: { path: 'C:/proj', label: 'proj' }, list: [] })
}));

vi.mock('@renderer/store/useToastStore.js', () => ({
  useToastStore: (sel: (s: { show: () => void }) => unknown) => sel({ show: vi.fn() })
}));

vi.mock('@renderer/store/useDockFileTreeRefreshStore.js', () => ({
  useDockFileTreeRefreshStore: (sel: (s: { version: number }) => unknown) => sel({ version: 0 })
}));

vi.mock('@renderer/store/useChatStore.js', () => ({
  useChatStore: (sel: (s: { conversationId: string | null; setDraft: () => void }) => unknown) =>
    sel({ conversationId: 'c1', setDraft: vi.fn() })
}));

describe('SkillsPanel', () => {
  it('lists discovered skills', async () => {
    render(<SkillsPanel />);
    expect(await screen.findByText('deploy-app')).toBeTruthy();
    expect(screen.getByText('create-skill')).toBeTruthy();
    expect(screen.getByText('Manual only')).toBeTruthy();
  });
});
