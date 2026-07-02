import { describe, expect, it } from 'vitest';
import {
  computeComposerModalityWarnings,
  unsupportedNativeMediaLabel
} from '@shared/attachments/composerModalityWarnings.js';
import type { PromptAttachmentMeta } from '@shared/types/chat.js';

const imageMeta: PromptAttachmentMeta = {
  id: 'a1',
  name: 'photo.png',
  workspacePath: 'photo.png',
  mediaKind: 'image'
};

describe('composerModalityWarnings', () => {
  it('flags vision when model lacks image input', () => {
    const warnings = computeComposerModalityWarnings([imageMeta], ['text']);
    expect(warnings.visionWarning).toBe(true);
    expect(warnings.pdfWarning).toBe(false);
  });

  it('clears warnings when model supports native media', () => {
    const warnings = computeComposerModalityWarnings([imageMeta], ['text', 'image']);
    expect(warnings.visionWarning).toBe(false);
  });

  it('builds unsupported media label for toast copy', () => {
    expect(unsupportedNativeMediaLabel([imageMeta], ['text'])).toBe('images');
  });
});
