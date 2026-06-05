import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@main/orchestrator/contextManager.js', () => ({
  inlineFiles: vi.fn(async () => '<file path="src/a.ts">body</file>')
}));

describe('resolveMentionsForInline', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('inlines workspace file mentions', async () => {
    const { resolveMentionsForInline } = await import(
      '@main/attachments/resolveMentionsForInline.js'
    );
    const out = await resolveMentionsForInline({
      workspacePath: '/ws',
      mentions: [
        {
          kind: 'file',
          id: 'm1',
          label: 'src/a.ts',
          workspacePath: 'src/a.ts'
        }
      ]
    });
    expect(out).toContain('src/a.ts');
  });

  it('returns empty string when mentions are absent', async () => {
    const { resolveMentionsForInline } = await import(
      '@main/attachments/resolveMentionsForInline.js'
    );
    expect(await resolveMentionsForInline({ workspacePath: '/ws' })).toBe('');
  });
});
