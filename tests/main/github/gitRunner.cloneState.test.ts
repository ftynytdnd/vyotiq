import { beforeEach, describe, expect, it, vi } from 'vitest';

const accessMock = vi.hoisted(() => vi.fn());

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    access: accessMock,
    rm: vi.fn()
  };
});

describe('detectGitCloneState', () => {
  beforeEach(() => {
    accessMock.mockReset();
  });

  it('returns absent when destination path is missing', async () => {
    accessMock.mockRejectedValue(new Error('ENOENT'));
    const { detectGitCloneState } = await import('@main/github/gitRunner.js');
    await expect(detectGitCloneState('/tmp/missing')).resolves.toBe('absent');
  });

  it('returns absent when .git directory is missing', async () => {
    accessMock.mockImplementation(async (path) => {
      if (String(path).endsWith('.git')) throw new Error('ENOENT');
    });
    const { detectGitCloneState } = await import('@main/github/gitRunner.js');
    await expect(detectGitCloneState('/tmp/ws')).resolves.toBe('absent');
  });
});
