/**
 * Vertical tablist keyboard navigation for the left dock.
 */

import { describe, expect, it, vi } from 'vitest';
import { handleDockVerticalTablistKeyDown } from '@renderer/components/dock/dockVerticalTablistKeyboard';

function keyEvent(key: string): React.KeyboardEvent {
  return {
    key,
    preventDefault: vi.fn()
  } as unknown as React.KeyboardEvent;
}

describe('handleDockVerticalTablistKeyDown', () => {
  it('ArrowDown activates the next tab', () => {
    const onActivate = vi.fn();
    const e = keyEvent('ArrowDown');
    handleDockVerticalTablistKeyDown({
      e,
      ids: ['a', 'b', 'c'],
      activeId: 'a',
      onActivate,
      focusTarget: () => null
    });
    expect(e.preventDefault).toHaveBeenCalled();
    expect(onActivate).toHaveBeenCalledWith('b');
  });

  it('ArrowUp wraps to the last tab', () => {
    const onActivate = vi.fn();
    const e = keyEvent('ArrowUp');
    handleDockVerticalTablistKeyDown({
      e,
      ids: ['a', 'b', 'c'],
      activeId: 'a',
      onActivate,
      focusTarget: () => null
    });
    expect(onActivate).toHaveBeenCalledWith('c');
  });

  it('Home and End jump to the ends', () => {
    const onActivate = vi.fn();
    handleDockVerticalTablistKeyDown({
      e: keyEvent('Home'),
      ids: ['a', 'b', 'c'],
      activeId: 'c',
      onActivate,
      focusTarget: () => null
    });
    expect(onActivate).toHaveBeenCalledWith('a');

    onActivate.mockClear();
    handleDockVerticalTablistKeyDown({
      e: keyEvent('End'),
      ids: ['a', 'b', 'c'],
      activeId: 'a',
      onActivate,
      focusTarget: () => null
    });
    expect(onActivate).toHaveBeenCalledWith('c');
  });
});
