import { describe, expect, it } from 'vitest';
import { measurePopoverPosition } from '@renderer/components/ui/popoverPosition';

function mockAnchor(rect: DOMRect): HTMLElement {
  return {
    getBoundingClientRect: () => rect
  } as HTMLElement;
}

function mockPopover(height: number, width = 400): HTMLElement {
  return {
    offsetHeight: height,
    offsetWidth: width
  } as HTMLElement;
}

describe('measurePopoverPosition', () => {
  it('opens below a centered anchor when preferSide is bottom', () => {
    const anchor = mockAnchor(new DOMRect(200, 400, 600, 120));
    const popover = mockPopover(480, 600);

    const pos = measurePopoverPosition(
      anchor,
      popover,
      8,
      'fit',
      { bottom: 56, top: 12, left: 56, right: 56 },
      'bottom',
      true
    );

    expect(pos.side).toBe('bottom');
    expect(pos.top).toBe(528);
    expect(pos.maxHeight).toBeLessThanOrEqual(window.innerHeight - pos.top - 56);
  });

  it('does not slide a bottom panel upward over the anchor when space is tight', () => {
    const anchor = mockAnchor(new DOMRect(200, 400, 600, 120));
    const popover = mockPopover(600, 600);

    const pos = measurePopoverPosition(
      anchor,
      popover,
      8,
      'fit',
      { bottom: 56, top: 12, left: 56, right: 56 },
      'bottom',
      true
    );

    expect(pos.top).toBeGreaterThanOrEqual(528);
    expect(pos.maxHeight).toBeDefined();
    expect((pos.maxHeight ?? 0) + pos.top).toBeLessThanOrEqual(window.innerHeight - 56);
  });

  it('opens above the composer shell when auto prefers top', () => {
    const anchor = mockAnchor(new DOMRect(200, 520, 600, 140));
    const popover = mockPopover(400, 600);

    const pos = measurePopoverPosition(
      anchor,
      popover,
      8,
      'fit',
      { bottom: 56, top: 46, left: 56, right: 56 },
      'auto',
      true
    );

    expect(pos.side).toBe('top');
    expect(pos.top + (pos.maxHeight ?? 0)).toBeLessThanOrEqual(520);
  });

  it('fits panel width within collision padding', () => {
    const anchor = mockAnchor(new DOMRect(300, 400, 600, 120));
    const popover = mockPopover(400, 768);

    const pos = measurePopoverPosition(
      anchor,
      popover,
      8,
      'fit',
      { bottom: 56, top: 46, left: 56, right: 56 },
      'auto',
      true
    );

    expect(pos.maxWidth).toBeDefined();
    expect((pos.maxWidth ?? 0) + pos.left).toBeLessThanOrEqual(window.innerWidth - 56);
    expect(pos.left).toBeGreaterThanOrEqual(56);
  });

  it('uses naturalHeight override instead of locked offsetHeight', () => {
    const anchor = mockAnchor(new DOMRect(200, 520, 600, 140));
    const lockedPopover = mockPopover(120, 400);

    const compact = measurePopoverPosition(
      anchor,
      lockedPopover,
      8,
      'fit',
      { bottom: 56, top: 46, left: 56, right: 56 },
      'top',
      true
    );

    const expanded = measurePopoverPosition(
      anchor,
      lockedPopover,
      8,
      'fit',
      { bottom: 56, top: 46, left: 56, right: 56 },
      'top',
      true,
      768,
      480
    );

    expect(compact.maxHeight ?? 0).toBeLessThanOrEqual(120);
    expect(expanded.maxHeight).toBeGreaterThan(compact.maxHeight ?? 0);
    expect(expanded.maxHeight).toBeLessThanOrEqual(480);
  });

  it('anchors end-aligned popovers to the trigger right edge before width is measured', () => {
    const anchor = mockAnchor(new DOMRect(1180, 8, 28, 28));
    const popover = mockPopover(120, 0);

    const pos = measurePopoverPosition(anchor, popover, 8, 'end', { right: 8, left: 8 }, 'bottom', true, 640);

    expect(pos.left).toBeGreaterThan(1000);
    expect(pos.left + (popover.offsetWidth || 28)).toBeLessThanOrEqual(1180 + 1);
  });

  it('centers on the anchor when align is center', () => {
    const anchor = mockAnchor(new DOMRect(400, 8, 120, 28));
    const popover = mockPopover(100, 200);

    const pos = measurePopoverPosition(anchor, popover, 8, 'center', { right: 8, left: 8 }, 'bottom', true, 640);

    expect(pos.left).toBeCloseTo(400 + 60 - 100, 0);
  });
});
