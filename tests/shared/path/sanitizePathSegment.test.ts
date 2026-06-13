import { describe, expect, it } from 'vitest';
import { sanitizePathSegment } from '@shared/path/sanitizePathSegment.js';

describe('sanitizePathSegment', () => {
  it('replaces colons from manual run ids', () => {
    expect(sanitizePathSegment('manual:27ea8d8f-915f-40a4-830f-be84634fc5bc')).toBe(
      'manual_27ea8d8f-915f-40a4-830f-be84634fc5bc'
    );
  });

  it('preserves uuid conversation ids', () => {
    const id = '3d019e40-56db-4924-b637-c98e52b9a534';
    expect(sanitizePathSegment(id)).toBe(id);
  });
});
