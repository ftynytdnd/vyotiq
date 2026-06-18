import { describe, expect, it } from 'vitest';
import { dockMainPaddingLeft } from '@shared/dock/dockWidth';

describe('dockMainPaddingLeft', () => {
  it('returns zero when flyout is collapsed', () => {
    expect(dockMainPaddingLeft(false, 260)).toBe(0);
  });

  it('returns panel width when flyout is expanded', () => {
    expect(dockMainPaddingLeft(true, 260)).toBe(260);
  });
});
