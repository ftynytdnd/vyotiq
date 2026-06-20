import { describe, expect, it } from 'vitest';
import { summarizeAttachmentRejections } from '@shared/attachments/summarizeAttachmentRejections';

describe('summarizeAttachmentRejections', () => {
  it('returns null for an empty list', () => {
    expect(summarizeAttachmentRejections([])).toBeNull();
  });

  it('returns the single rejection reason verbatim', () => {
    expect(
      summarizeAttachmentRejections([{ name: 'huge.zip', reason: 'huge.zip exceeds 10 MB limit' }])
    ).toBe('huge.zip exceeds 10 MB limit');
  });

  it('summarizes multiple size-limit rejections', () => {
    expect(
      summarizeAttachmentRejections([
        { name: 'a.bin', reason: 'a.bin exceeds 10 MB limit' },
        { name: 'b.bin', reason: 'b.bin exceeds 10 MB limit' }
      ])
    ).toBe('2 files exceed the size limit and were skipped.');
  });
});
