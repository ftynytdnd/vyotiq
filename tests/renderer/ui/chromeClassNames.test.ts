import { describe, expect, it } from 'vitest';
import {
  chromeBadgeClassName,
  chromeFilterChipClassName,
  chromeElev2PanelClassName,
  chromeInsetNoteClassName,
  chromeMeterClassName,
  chromeFileKindBadgeClassName,
  chromePopoverPanelClassName,
  chromeStatusPillClassName,
  chromePillClassName,
  chromeProgressTrackClassName,
  chromeRowActionClassName,
  chromeTabActiveClassName,
  chromeTabIdleClassName
} from '../../../src/renderer/components/ui/SurfaceShell.js';

describe('chrome class helpers', () => {
  it('ghost pill has no resting overlay fill', () => {
    const idle = chromePillClassName(false);
    expect(idle).not.toContain('bg-surface-overlay');
    expect(chromePillClassName(true)).toContain('bg-surface-hover');
  });

  it('meter chip keeps persistent overlay fill', () => {
    expect(chromeMeterClassName()).toContain('bg-surface-overlay');
  });

  it('tab idle is transparent at rest', () => {
    expect(chromeTabIdleClassName).not.toContain('bg-surface-overlay');
    expect(chromeTabActiveClassName).toContain('bg-surface-hover');
  });

  it('filter chip is ghost when inactive', () => {
    const idle = chromeFilterChipClassName(false);
    expect(idle).not.toContain('bg-surface-overlay');
    expect(chromeFilterChipClassName(true)).toContain('bg-accent-soft');
  });

  it('badge and row action avoid resting overlay fill', () => {
    expect(chromeBadgeClassName).not.toContain('bg-surface-overlay');
    expect(chromeRowActionClassName).not.toContain('bg-surface-overlay');
    expect(chromeRowActionClassName).toContain('hover:bg-surface-hover');
  });

  it('inset note and progress track avoid heavy overlay fill', () => {
    expect(chromeInsetNoteClassName).not.toContain('bg-surface-overlay');
    expect(chromeProgressTrackClassName).not.toContain('bg-surface-overlay');
  });

  it('popover panels use shared elev + overlay base', () => {
    expect(chromePopoverPanelClassName).toContain('elev-1');
    expect(chromePopoverPanelClassName).toContain('bg-surface-overlay');
    expect(chromeElev2PanelClassName).toContain('elev-2');
  });

  it('status and file-kind badges use semantic or neutral tones', () => {
    expect(chromeStatusPillClassName('success')).toContain('bg-success-soft');
    expect(chromeStatusPillClassName('neutral')).not.toContain('bg-surface-overlay');
    expect(chromeFileKindBadgeClassName('modify')).toContain('border');
  });
});
