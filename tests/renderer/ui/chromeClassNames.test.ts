import { describe, expect, it } from 'vitest';
import {
  chromeBadgeClassName,
  chromeEmptyNoteClassName,
  chromeFilterChipClassName,
  chromeInsetNoteClassName,
  chromeListEmptyBodyClassName,
  chromeListEmptyClassName,
  chromeMeterClassName,
  chromeNoMatchesClassName,
  chromeFileKindBadgeClassName,
  chromePopoverPanelClassName,
  chromeSettingsCardClassName,
  chromeStatusPillClassName,
  chromePillClassName,
  chromeProgressTrackClassName,
  chromeRowActionClassName,
  chromeTabActiveClassName,
  chromeTabIdleClassName,
  chromeGhostRowButtonClassName,
  chromeSegmentedTrayClassName,
  secondaryZoneTabStripClassName,
  appPanelFrameClassName,
  appPanelHeadClassName,
  appDialogFrameClassName,
  appDialogBodyClassName,
  appPopoverPanelClassName,
  surfaceShellInnerClassName
} from '../../../src/renderer/components/ui/SurfaceShell.js';

describe('chrome class helpers', () => {
  it('ghost pill uses soft fill when active', () => {
    const idle = chromePillClassName(false);
    expect(idle).not.toContain('bg-surface-overlay');
    expect(chromePillClassName(true)).toContain('bg-chrome-hover-soft');
    expect(chromePillClassName(true)).toContain('text-text-primary');
  });

  it('meter chip keeps persistent overlay fill', () => {
    expect(chromeMeterClassName()).toContain('bg-surface-overlay');
  });

  it('tab idle is transparent at rest', () => {
    expect(chromeTabIdleClassName).not.toContain('bg-surface-overlay');
    expect(chromeTabActiveClassName).toContain('vx-tab-pill-active');
  });

  it('filter chip is ghost when inactive', () => {
    const idle = chromeFilterChipClassName(false);
    expect(idle).not.toContain('bg-surface-overlay');
    expect(chromeFilterChipClassName(true)).toContain('bg-accent-soft');
  });

  it('badge and row action avoid resting overlay fill', () => {
    expect(chromeBadgeClassName).not.toContain('bg-surface-overlay');
    expect(chromeRowActionClassName).not.toContain('bg-surface-overlay');
    expect(chromeRowActionClassName).toContain('vx-timeline-action');
  });

  it('inset note and progress track avoid heavy overlay fill', () => {
    expect(chromeInsetNoteClassName).not.toContain('bg-surface-overlay');
    expect(chromeProgressTrackClassName).not.toContain('bg-surface-overlay');
  });

  it('popover panels use Vyotiq UI overlay panel', () => {
    expect(chromePopoverPanelClassName).toContain('vx-popover-panel');
    expect(appPopoverPanelClassName).toContain('vx-popover-panel');
  });

  it('status and file-kind badges use semantic or neutral tones', () => {
    expect(chromeStatusPillClassName('success')).toContain('bg-success-soft');
    expect(chromeStatusPillClassName('neutral')).not.toContain('bg-surface-overlay');
    expect(chromeFileKindBadgeClassName('modify')).toContain('border');
  });

  it('list empty uses Vyotiq UI row rhythm', () => {
    expect(chromeListEmptyClassName).toContain('vx-section-body');
    expect(chromeListEmptyClassName).toContain(chromeListEmptyBodyClassName);
    expect(chromeListEmptyBodyClassName).toContain('vx-row');
    expect(chromeListEmptyBodyClassName).toContain('text-text-muted');
    expect(chromeSettingsCardClassName).toContain('vx-section-body');
  });

  it('no-matches helper uses compact padding without card chrome', () => {
    expect(chromeNoMatchesClassName).toContain('px-2.5');
    expect(chromeNoMatchesClassName).toContain('text-text-muted');
    expect(chromeNoMatchesClassName).not.toContain('rounded-card');
  });

  it('secondary zone tab strip is a lightweight wrapper', () => {
    expect(secondaryZoneTabStripClassName).toContain('shrink-0');
    expect(secondaryZoneTabStripClassName).not.toContain('border-b');
  });

  it('Vyotiq UI panel frame helpers map to vx-panel-* classes', () => {
    expect(appPanelFrameClassName).toContain('vx-panel-frame');
    expect(appPanelHeadClassName).toContain('vx-panel-head');
  });

  it('settings ghost row button uses Vyotiq UI quiet btn', () => {
    expect(chromeGhostRowButtonClassName).toContain('vx-btn-quiet');
  });

  it('segmented tray uses Vyotiq UI segment', () => {
    expect(chromeSegmentedTrayClassName(false)).toContain('vx-segment-fluid');
    expect(chromeSegmentedTrayClassName(true)).toContain('vx-segment');
  });

  it('empty note muted tone overrides inset faint default', () => {
    expect(chromeEmptyNoteClassName('default')).toContain('text-text-faint');
    expect(chromeEmptyNoteClassName('muted')).toContain('text-text-muted');
    expect(chromeEmptyNoteClassName('muted')).toContain('border-border-subtle');
  });

  it('panel frame uses full-height stretch', () => {
    expect(appPanelFrameClassName).toContain('h-full');
  });

  it('dialog frame is content-sized', () => {
    expect(appDialogFrameClassName).toContain('h-auto');
    expect(appDialogFrameClassName).not.toContain('h-full');
    expect(appDialogBodyClassName).toContain('shrink-0');
    expect(appDialogBodyClassName).not.toContain('flex-1');
  });

  it('surface shell padding presets use tightened rhythm', () => {
    expect(surfaceShellInnerClassName('compact')).toContain('px-1.5');
    expect(surfaceShellInnerClassName('content')).toContain('px-2.5');
    expect(surfaceShellInnerClassName('nested')).toContain('px-2');
  });
});
