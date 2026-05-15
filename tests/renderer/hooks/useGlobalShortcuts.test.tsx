/**
 * `useGlobalShortcuts` tests. Verify Ctrl+N / Ctrl+O / Ctrl+, route
 * to the configured callbacks, and that other modifier combinations
 * are NOT intercepted.
 */

import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { useGlobalShortcuts } from '@renderer/hooks/useGlobalShortcuts';

function Harness({
  newConversation,
  openWorkspace,
  openSettings
}: {
  newConversation: () => void;
  openWorkspace: () => void;
  openSettings: () => void;
}) {
  useGlobalShortcuts({ newConversation, openWorkspace, openSettings });
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
});
