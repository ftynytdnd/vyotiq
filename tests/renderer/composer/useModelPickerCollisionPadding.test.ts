import { describe, expect, it, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useModelPickerCollisionPadding } from '@renderer/components/composer/modelPicker/useModelPickerCollisionPadding';
import { useUiStore } from '@renderer/store/useUiStore';
import { DOCK_STRIP_WIDTH } from '@shared/dock/dockWidth';

beforeEach(() => {
  useUiStore.setState({ dockExpanded: false, dockWidth: 260 });
});

describe('useModelPickerCollisionPadding', () => {
  it('includes dock strip in left inset when flyout is collapsed', () => {
    const { result } = renderHook(() => useModelPickerCollisionPadding());
    expect(result.current.left).toBe(DOCK_STRIP_WIDTH + 12);
    expect(result.current.right).toBe(DOCK_STRIP_WIDTH + 12);
  });

  it('expands left inset when dock flyout is open', () => {
    useUiStore.setState({ dockExpanded: true, dockWidth: 260 });
    const { result } = renderHook(() => useModelPickerCollisionPadding());
    expect(result.current.left).toBe(DOCK_STRIP_WIDTH + 260 + 12);
  });
});
