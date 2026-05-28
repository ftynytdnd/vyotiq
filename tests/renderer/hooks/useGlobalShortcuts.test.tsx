/**
 * `useGlobalShortcuts` tests. Verify Ctrl+N / Ctrl+O / Ctrl+, /
 * Ctrl+R / Ctrl+Shift+I route to the configured callbacks, and that
 * other modifier combinations are NOT intercepted.
 */

import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import {
  useGlobalShortcuts,
  type GlobalShortcutActions
} from '@renderer/hooks/useGlobalShortcuts';

function Harness(actions: GlobalShortcutActions) {
  useGlobalShortcuts(actions);
  return <div data-testid="harness" />;
}

function fireKey(key: string, opts: KeyboardEventInit = {}): void {
  window.dispatchEvent(new KeyboardEvent('keydown', { key, ...opts }));
}

describe('useGlobalShortcuts', () => {
  it('fires newConversation on Ctrl+N', () => {
    const onNew = vi.fn();
    const onOpen = vi.fn();
    const onSettings = vi.fn();
    render(
      <Harness
        newConversation={onNew}
        openWorkspace={onOpen}
        openSettings={onSettings}
      />
    );
    fireKey('n', { ctrlKey: true });
    expect(onNew).toHaveBeenCalledOnce();
    expect(onOpen).not.toHaveBeenCalled();
    expect(onSettings).not.toHaveBeenCalled();
  });

  it('fires openWorkspace on Ctrl+O', () => {
    const cb = vi.fn();
    render(
      <Harness
        newConversation={() => { }}
        openWorkspace={cb}
        openSettings={() => { }}
      />
    );
    fireKey('o', { ctrlKey: true });
    expect(cb).toHaveBeenCalledOnce();
  });

  it('fires openSettings on Ctrl+,', () => {
    const cb = vi.fn();
    render(
      <Harness
        newConversation={() => { }}
        openWorkspace={() => { }}
        openSettings={cb}
      />
    );
    fireKey(',', { ctrlKey: true });
    expect(cb).toHaveBeenCalledOnce();
  });

  it('also accepts Cmd as the modifier (mac shortcut)', () => {
    const cb = vi.fn();
    render(
      <Harness
        newConversation={cb}
        openWorkspace={() => { }}
        openSettings={() => { }}
      />
    );
    fireKey('n', { metaKey: true });
    expect(cb).toHaveBeenCalledOnce();
  });

  it('does NOT fire when Shift or Alt is also held', () => {
    const cb = vi.fn();
    render(
      <Harness
        newConversation={cb}
        openWorkspace={() => { }}
        openSettings={() => { }}
      />
    );
    fireKey('n', { ctrlKey: true, shiftKey: true });
    fireKey('n', { ctrlKey: true, altKey: true });
    expect(cb).not.toHaveBeenCalled();
  });

  it('does NOT fire on Ctrl+N held with no modifier', () => {
    const cb = vi.fn();
    render(
      <Harness
        newConversation={cb}
        openWorkspace={() => { }}
        openSettings={() => { }}
      />
    );
    fireKey('n');
    expect(cb).not.toHaveBeenCalled();
  });

  it('reads the LATEST callbacks via ref (no stale closure across re-renders)', () => {
    const a = vi.fn();
    const b = vi.fn();
    const { rerender } = render(
      <Harness
        newConversation={a}
        openWorkspace={() => { }}
        openSettings={() => { }}
      />
    );
    fireKey('n', { ctrlKey: true });
    expect(a).toHaveBeenCalledOnce();
    // Re-render with a fresh handler. The ref should now point at `b`,
    // and `a` must NOT receive the next keystroke.
    rerender(
      <Harness
        newConversation={b}
        openWorkspace={() => { }}
        openSettings={() => { }}
      />
    );
    fireKey('n', { ctrlKey: true });
    expect(a).toHaveBeenCalledOnce();
    expect(b).toHaveBeenCalledOnce();
  });

  // ──────────────────────────────────────────────────────────────────
  // View-menu shortcuts (Ctrl+R / Ctrl+Shift+I).
  // ──────────────────────────────────────────────────────────────────

  it('fires reload on Ctrl+R', () => {
    const reload = vi.fn();
    render(
      <Harness
        newConversation={() => { }}
        openWorkspace={() => { }}
        openSettings={() => { }}
        reload={reload}
      />
    );
    fireKey('r', { ctrlKey: true });
    expect(reload).toHaveBeenCalledOnce();
  });

  it('does NOT fire reload on Ctrl+Alt+R', () => {
    const reload = vi.fn();
    render(
      <Harness
        newConversation={() => { }}
        openWorkspace={() => { }}
        openSettings={() => { }}
        reload={reload}
      />
    );
    fireKey('r', { ctrlKey: true, altKey: true });
    expect(reload).not.toHaveBeenCalled();
  });

  it('fires toggleDevTools on Ctrl+Shift+I', () => {
    const toggleDevTools = vi.fn();
    render(
      <Harness
        newConversation={() => { }}
        openWorkspace={() => { }}
        openSettings={() => { }}
        toggleDevTools={toggleDevTools}
      />
    );
    // Windows / Chromium delivers `I` (uppercase) when Shift is held;
    // the hook lowercases the key for the comparison so either casing
    // must work.
    fireKey('I', { ctrlKey: true, shiftKey: true });
    expect(toggleDevTools).toHaveBeenCalledOnce();
  });

  it('does NOT fire toggleDevTools on plain Ctrl+I', () => {
    const toggleDevTools = vi.fn();
    render(
      <Harness
        newConversation={() => { }}
        openWorkspace={() => { }}
        openSettings={() => { }}
        toggleDevTools={toggleDevTools}
      />
    );
    fireKey('i', { ctrlKey: true });
    expect(toggleDevTools).not.toHaveBeenCalled();
  });

  it('removes keydown and keyup listeners on unmount', () => {
    const addSpy = vi.spyOn(window, 'addEventListener');
    const removeSpy = vi.spyOn(window, 'removeEventListener');
    const { unmount } = render(
      <Harness
        newConversation={() => {}}
        openWorkspace={() => {}}
        openSettings={() => {}}
      />
    );
    const addedKeydown = addSpy.mock.calls.filter((c) => c[0] === 'keydown').length;
    const addedKeyup = addSpy.mock.calls.filter((c) => c[0] === 'keyup').length;
    expect(addedKeydown).toBeGreaterThan(0);
    expect(addedKeyup).toBeGreaterThan(0);
    unmount();
    expect(removeSpy.mock.calls.filter((c) => c[0] === 'keydown').length).toBe(addedKeydown);
    expect(removeSpy.mock.calls.filter((c) => c[0] === 'keyup').length).toBe(addedKeyup);
    addSpy.mockRestore();
    removeSpy.mockRestore();
  });

  it('silently ignores Ctrl+R / Ctrl+Shift+I when handlers are undefined', () => {
    // Sibling handlers must NOT be invoked either — the keystrokes
    // should be a no-op when the optional reload / toggleDevTools
    // callbacks are not provided.
    const onNew = vi.fn();
    const onOpen = vi.fn();
    const onSettings = vi.fn();
    render(
      <Harness
        newConversation={onNew}
        openWorkspace={onOpen}
        openSettings={onSettings}
      />
    );
    fireKey('r', { ctrlKey: true });
    fireKey('I', { ctrlKey: true, shiftKey: true });
    expect(onNew).not.toHaveBeenCalled();
    expect(onOpen).not.toHaveBeenCalled();
    expect(onSettings).not.toHaveBeenCalled();
  });
});
