import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  __test_resetEscapeLayerStack,
  registerEscapeLayer
} from '@renderer/lib/escapeLayerStack.js';

afterEach(() => {
  __test_resetEscapeLayerStack();
});

describe('escapeLayerStack', () => {
  it('invokes the highest-priority layer first', () => {
    const low = vi.fn(() => false);
    const high = vi.fn(() => true);
    const unregisterLow = registerEscapeLayer('low', 40, low);
    registerEscapeLayer('high', 90, high);

    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true });
    document.dispatchEvent(event);

    expect(high).toHaveBeenCalledTimes(1);
    expect(low).not.toHaveBeenCalled();
    unregisterLow();
  });

  it('removes layers on unregister without leaking listeners', () => {
    const handler = vi.fn(() => true);
    const unregister = registerEscapeLayer('only', 50, handler);
    unregister();

    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true });
    document.dispatchEvent(event);
    expect(handler).not.toHaveBeenCalled();
  });
});
