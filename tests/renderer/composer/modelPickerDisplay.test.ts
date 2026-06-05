import { describe, expect, it } from 'vitest';
import {
  rowContextBadgeLabel,
  rowDisplayModelId,
  shouldShowEffortBadge
} from '@renderer/components/composer/modelPicker/modelPickerDisplay';

describe('modelPickerDisplay', () => {
  it('rowDisplayModelId returns tail after vendor slash', () => {
    expect(rowDisplayModelId('google/gemma-4-26b-a4b-it:free')).toBe('gemma-4-26b-a4b-it:free');
    expect(rowDisplayModelId('gemma4:31b')).toBe('gemma4:31b');
  });

  it('rowContextBadgeLabel formats with ctx suffix', () => {
    expect(rowContextBadgeLabel(262_144)).toBe('262.1k ctx');
  });

  it('shouldShowEffortBadge hides default and off', () => {
    expect(shouldShowEffortBadge(undefined, true)).toBe(false);
    expect(shouldShowEffortBadge('off', true)).toBe(false);
    expect(shouldShowEffortBadge('high', true)).toBe(true);
    expect(shouldShowEffortBadge('high', false)).toBe(false);
  });
});
