import { describe, expect, it } from 'vitest';
import { attachmentPreReadCopy } from '@shared/attachments/attachmentPreReadCopy';

describe('attachmentPreReadCopy', () => {
  it('describes vision attachments without inlined wording', () => {
    expect(attachmentPreReadCopy('.vyotiq/captures/window-1.png', 'image')).toBe(
      'Screenshot attached — `.vyotiq/captures/window-1.png` sent to vision for this run'
    );
  });

  it('describes inlined text attachments', () => {
    expect(attachmentPreReadCopy('src/app.ts', 'text')).toBe(
      'File attached — `src/app.ts` inlined for this run'
    );
  });
});
