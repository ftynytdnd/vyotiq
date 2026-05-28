/**
 * resolveAttachmentsForInline — attachmentMeta workspace + external paths.
 */

import { describe, expect, it, vi } from 'vitest';
import type { PromptAttachmentMeta } from '@shared/types/chat.js';

const inlineFiles = vi.fn(async (_ws: string, paths: string[]) =>
  paths.map((p) => `<file path="${p}">workspace-body</file>`).join('\n\n')
);

vi.mock('@main/orchestrator/contextManager.js', () => ({
  inlineFiles: (...args: unknown[]) => inlineFiles(...args)
}));

vi.mock('@main/attachments/sandbox.js', () => ({
  realpathInsideAttachmentsRoot: vi.fn(async (p: string) => `/attachments-root/${p}`)
}));

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(async () => 'external-file-body')
}));

describe('resolveAttachmentsForInline', () => {
  it('inlines workspace paths from attachmentMeta', async () => {
    inlineFiles.mockClear();
    const { resolveAttachmentsForInline } = await import(
      '@main/attachments/resolveAttachmentsForInline.js'
    );
    const meta: PromptAttachmentMeta[] = [
      { name: 'a.ts', workspacePath: 'src/a.ts' }
    ];
    const out = await resolveAttachmentsForInline({
      attachmentMeta: meta,
      workspacePath: '/proj'
    });
    expect(inlineFiles).toHaveBeenCalledWith('/proj', ['src/a.ts'], undefined, undefined);
    expect(out).toContain('workspace-body');
  });

  it('inlines external storedPath attachments', async () => {
    inlineFiles.mockClear();
    const { resolveAttachmentsForInline } = await import(
      '@main/attachments/resolveAttachmentsForInline.js'
    );
    const meta: PromptAttachmentMeta[] = [
      { name: 'notes.txt', storedPath: 'conv/notes.txt' }
    ];
    const out = await resolveAttachmentsForInline({
      attachmentMeta: meta,
      workspacePath: '/proj'
    });
    expect(inlineFiles).not.toHaveBeenCalled();
    expect(out).toContain('<file path="notes.txt">');
    expect(out).toContain('external-file-body');
  });

  it('emits image-reference blocks instead of inlining bytes', async () => {
    inlineFiles.mockClear();
    const { resolveAttachmentsForInline } = await import(
      '@main/attachments/resolveAttachmentsForInline.js'
    );
    const meta: PromptAttachmentMeta[] = [
      {
        name: 'shot.png',
        mimeType: 'image/png',
        sizeBytes: 4096,
        workspacePath: 'assets/shot.png'
      },
      { name: 'drop.png', mimeType: 'image/png', storedPath: 'conv/drop.png' }
    ];
    const out = await resolveAttachmentsForInline({
      attachmentMeta: meta,
      workspacePath: '/proj'
    });
    expect(inlineFiles).not.toHaveBeenCalled();
    expect(out).toContain('kind="image-reference"');
    expect(out).toContain('path="assets/shot.png"');
    expect(out).toContain('path="drop.png"');
    expect(out).not.toContain('external-file-body');
  });

  it('falls back to legacy attachments string array', async () => {
    inlineFiles.mockClear();
    const { resolveAttachmentsForInline } = await import(
      '@main/attachments/resolveAttachmentsForInline.js'
    );
    const out = await resolveAttachmentsForInline({
      legacyAttachments: ['README.md'],
      workspacePath: '/proj'
    });
    expect(inlineFiles).toHaveBeenCalledWith('/proj', ['README.md'], undefined, undefined);
    expect(out).toContain('workspace-body');
  });
});
