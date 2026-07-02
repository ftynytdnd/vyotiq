import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ipcMain } from 'electron';
import { IPC } from '@shared/constants';

interface MockIpcMain {
  __invoke: (channel: string, ...args: unknown[]) => unknown;
  __handlers: Map<string, unknown>;
}

const mockIpc = ipcMain as unknown as MockIpcMain;

const listSkills = vi.fn(async () => [
  {
    name: 'demo-skill',
    description: 'Demo',
    source: 'workspace' as const,
    disableModelInvocation: false
  }
]);
const findSkill = vi.fn(async () => null);
const readSkillFileContent = vi.fn();
const requireWorkspaceById = vi.fn(async () => '/tmp/ws');
const invalidateSkillRegistry = vi.fn();
const emitWorkspaceTreeChanged = vi.fn();

vi.mock('@main/skills/skillOverrides.js', () => ({
  writeSkillOverride: vi.fn(async () => undefined),
  resetSkillOverride: vi.fn(async () => undefined)
}));

vi.mock('@main/skills/skillRegistry.js', () => ({
  listSkills: (...args: unknown[]) => listSkills(...args),
  findSkill: (...args: unknown[]) => findSkill(...args),
  readSkillFileContent: (...args: unknown[]) => readSkillFileContent(...args),
  invalidateSkillRegistry: (...args: unknown[]) => invalidateSkillRegistry(...args)
}));

vi.mock('@main/workspace/workspaceState.js', () => ({
  requireWorkspaceById: (...args: unknown[]) => requireWorkspaceById(...args)
}));

vi.mock('@main/workspace/workspaceTreeWatcher.js', () => ({
  emitWorkspaceTreeChanged: (...args: unknown[]) => emitWorkspaceTreeChanged(...args)
}));

beforeEach(async () => {
  listSkills.mockClear();
  findSkill.mockClear();
  requireWorkspaceById.mockClear();
  mockIpc.__handlers.clear();
  const { registerSkillsIpc } = await import('@main/ipc/skills.ipc.js');
  registerSkillsIpc();
});

describe('skills IPC', () => {
  it('skills:list resolves workspace and returns catalogue', async () => {
    const rows = await mockIpc.__invoke(IPC.SKILLS_LIST, 'ws-1');
    expect(requireWorkspaceById).toHaveBeenCalledWith('ws-1');
    expect(listSkills).toHaveBeenCalledWith('/tmp/ws');
    expect(rows).toEqual([
      expect.objectContaining({ name: 'demo-skill', source: 'workspace' })
    ]);
  });

  it('skills:read throws for unknown skill', async () => {
    findSkill.mockResolvedValueOnce(null);
    await expect(mockIpc.__invoke(IPC.SKILLS_READ, 'ws-1', 'missing')).rejects.toThrow(
      /unknown skill/
    );
  });

  it('skills:write-override writes bundled skill override', async () => {
    const { writeSkillOverride } = await import('@main/skills/skillOverrides.js');
    findSkill.mockResolvedValueOnce({
      name: 'review-checklist',
      source: 'bundled',
      description: 'Review'
    });
    const result = await mockIpc.__invoke(
      IPC.SKILLS_WRITE_OVERRIDE,
      'ws-1',
      'review-checklist',
      '# body'
    );
    expect(writeSkillOverride).toHaveBeenCalledWith('review-checklist', '# body');
    expect(invalidateSkillRegistry).toHaveBeenCalled();
    expect(result).toEqual({ ok: true });
  });
});
