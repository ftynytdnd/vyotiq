import { describe, expect, it } from 'vitest';
import { defaultAttachmentPrompt } from '@shared/attachments/defaultAttachmentPrompt';
import type { PromptAttachmentMeta } from '@shared/types/chat';

function meta(name: string, mimeType?: string): PromptAttachmentMeta {
  return { id: '1', name, ...(mimeType ? { mimeType } : {}) };
}

describe('defaultAttachmentPrompt', () => {
  it('uses screenshot copy for a single image', () => {
    expect(defaultAttachmentPrompt([meta('shot.png', 'image/png')])).toBe(
      'See attached screenshot.'
    );
  });

  it('uses screenshots copy for multiple images', () => {
    expect(
      defaultAttachmentPrompt([meta('a.png', 'image/png'), meta('b.png', 'image/png')])
    ).toBe('See attached screenshots.');
  });

  it('uses files copy for mixed or text attachments', () => {
    expect(defaultAttachmentPrompt([meta('readme.md', 'text/markdown')])).toBe(
      'See attached files.'
    );
    expect(
      defaultAttachmentPrompt([meta('shot.png', 'image/png'), meta('notes.md', 'text/plain')])
    ).toBe('See attached files.');
  });
});
